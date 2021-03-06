import { HookDescRunnerParam, HookScope, LifecycleHookEnum, LifecycleHookRunner } from './type';
import { getHooksScopes, getScopeHooks, getScopeHookNames } from './using';
import { getScopeName, makeSafeScope } from '../utils/helpers';
import { BaseType } from '../weapp/base';
import { getPageConfigs } from './register';
import { errorHandler } from '../error';
import { getScope, compoundScope } from '../weapp';
import { PageConfig } from '../weapp/page';
import { getAppStatus, unloadApplication } from 'single-spa';
import { getContext } from '../context';

const MatchedPageScope: { [pageName: string]: HookDescRunnerParam<any> } = {};
let EnabledHookScopes: HookDescRunnerParam<any>[] = [];

export function getEnabledHookNames() {
  let enabledHookNames = [];
  EnabledHookScopes.forEach(({ hookScope }) => {
    const scopeHookNames = getScopeHookNames(hookScope.scopeName);
    enabledHookNames = enabledHookNames.concat(scopeHookNames);
  });
  return Array.from(new Set(enabledHookNames));
}

function matchHookDescRunnerParam(sourceHookScope: HookScope, forMatchedHookScopes: (string | HookScope)[]) {
  const pageScopeName = sourceHookScope.scopeName;
  const appScopeName = getScopeName({ ...sourceHookScope, pageName: '' });
  const productScopeName = getScopeName({ ...sourceHookScope, appName: '', pageName: '' });
  const activeScopeNames = [pageScopeName, appScopeName, productScopeName];
  // 根据activePageScope匹配hooksScope，一个页面只会有一个hooksScope
  const matchedHookScopes = forMatchedHookScopes.map((hooksScope) => {
    const hookScope = typeof hooksScope === 'string' ? getScope(hooksScope) : hooksScope;
    return hookScope;
  }).filter((hookScope) => {
    if (!hookScope) {
      return false;
    }

    const matched = activeScopeNames.indexOf(hookScope.scopeName) > -1;
    if (matched) {
      return true;
    }

    return (
      !hookScope.pageName &&
      !hookScope.appName &&
      hookScope.product.type === BaseType.root
    );
  });

  let matchedHookScope = matchedHookScopes[0];
  if (matchedHookScopes.length > 1) {
    // 从多个匹配的scope中选择作用域最小的一个
    // 作用域最小则长度最长
    const len = [];
    matchedHookScopes.map((scope) => {
      return [
        scope,
        scope.productName,
        scope.appName,
        scope.pageName,
      ].filter((m) => m);
    }).forEach((m) => {
      len[m.length] = m;
    });
    matchedHookScope = len[len.length - 1][0];
  }

  const hookDescRunnerParam: HookDescRunnerParam<any> = {
    pageScope: sourceHookScope,
    hookScope: matchedHookScope,
  };

  return hookDescRunnerParam;
}

function matchActivePageHookDescRunnerParam(activePageScope: HookScope) {
  const pageScopeName = getScopeName(activePageScope);
  activePageScope.scopeName = pageScopeName;

  if (MatchedPageScope[pageScopeName]) {
    return MatchedPageScope[pageScopeName];
  }

  // 根据activePageScope匹配hooksScope，一个页面只会有一个hooksScope
  const hooksScopes = getHooksScopes();
  const hookDescRunnerParam = matchHookDescRunnerParam(activePageScope, hooksScopes);

  MatchedPageScope[pageScopeName] = hookDescRunnerParam;

  return hookDescRunnerParam;
}

function matchHookDescRunnerParams(activePageScopes: HookScope[], lifecycleHook: LifecycleHookEnum) {
  const lastEnabledHookDescRunnerParams = [...EnabledHookScopes];
  // 根据activePageScope匹配hooksScope，一个页面只会有一个hooksScope
  const enabledHookDescRunnerParams = activePageScopes.map((activePageScope) => {
    return matchActivePageHookDescRunnerParam(activePageScope);
  });

  if (lifecycleHook === LifecycleHookEnum.beforeRouting) {
    EnabledHookScopes = enabledHookDescRunnerParams;

    // 计算新启用hookScopes
    const newEnabledHookDescRunnerParams: HookDescRunnerParam<any>[] = [];
    // 计算已启用hookScopes
    const alreadyEnabledHookDescRunnerParams: HookDescRunnerParam<any>[] = [];
    // 计算禁用hookScopes
    // 找到上一个scope在当前scope中不存在的
    const disabledHookDescRunnerParams: HookDescRunnerParam<any>[] = [...lastEnabledHookDescRunnerParams];

    enabledHookDescRunnerParams.forEach((enabledHookDescRunnerParam) => {
      const { hookScope } = enabledHookDescRunnerParam;
      // 不在上一次的启用hookScopes中，则为新启用hookScopes
      // 在上一次的启用hookScopes中，则为已启用hookScopes，并移除
      // 上一次启用hookScopes中剩余的就是本次需要禁用的hookScopes
      const index = disabledHookDescRunnerParams.findIndex(({ hookScope: lastHookScope }) => {
        return hookScope.scopeName === lastHookScope.scopeName;
      });
      if (index === -1) {
        newEnabledHookDescRunnerParams.push(enabledHookDescRunnerParam);
      } else {
        alreadyEnabledHookDescRunnerParams.push(enabledHookDescRunnerParam);
        disabledHookDescRunnerParams.splice(index, 1);
      }
    });

    const matchedHookDescRunnerParams = {
      enabledHookDescRunnerParams,
      newEnabledHookDescRunnerParams,
      alreadyEnabledHookDescRunnerParams,
      disabledHookDescRunnerParams,
    };

    return matchedHookDescRunnerParams;
  } else {
    return {
      enabledHookDescRunnerParams,
      newEnabledHookDescRunnerParams: enabledHookDescRunnerParams,
      alreadyEnabledHookDescRunnerParams: [],
      disabledHookDescRunnerParams: [],
    };
  }
}

export async function runLifecycleHook(lifecycleHook: LifecycleHookEnum, activePageScopes: HookScope[], props?: any) {
  const hookPages = getPageConfigs().map((hookPage) => getScopeName({ hookName: hookPage.hookName }));
  // beforeRouting 区别于其他页面生命周期
  // 在路由切换时，RootProduct应当是始终都需要执行的
  if (lifecycleHook === LifecycleHookEnum.beforeRouting) {
    const RootScope = compoundScope();
    activePageScopes.unshift(RootScope);

    const RootScopeName = getScopeName(RootScope);
    hookPages.push(RootScopeName);
  }

  const { enabledHookDescRunnerParams,
    disabledHookDescRunnerParams } = matchHookDescRunnerParams(activePageScopes, lifecycleHook);

  const scopeHooksRunners: [LifecycleHookRunner<any>, HookDescRunnerParam<any>][] = [];
  const activePages = activePageScopes.map((activeScope) => {
    return getScopeName(activeScope);
  });
  // 禁用hook，调用clear
  if (lifecycleHook === LifecycleHookEnum.beforeRouting) {
    const enabledHookScopes = enabledHookDescRunnerParams.map(({ hookScope }) => hookScope);
    disabledHookDescRunnerParams.forEach(({ pageScope, hookScope }) => {
      // 像skeleton、basicLibs等扩展，如果前后hookScope存在祖孙关系，则不能清理
      // 所以需要在新启用的hookScope中找到与当前禁用hookScope相匹配的项，供扩展进行判断
      const nextHookDescRunnerParam = matchHookDescRunnerParam(hookScope, enabledHookScopes);
      const scopeHooks = getScopeHooks(hookScope.scopeName);
      scopeHooks.forEach(({ hookDescEntity, opts, hookName }) => {
        // 生命周期钩子函数获取
        const hookDescRunner = hookDescEntity(lifecycleHook);
        if (hookDescRunner && 'clear' in hookDescRunner) {
          scopeHooksRunners.push([hookDescRunner.clear, {
            ...props,
            hookName,
            pageScope: makeSafeScope(pageScope),
            hookScope: makeSafeScope(hookScope),
            opts,
            matched: false,
            hookPages,
            activePages,
            nextHookDescRunnerParam: {
              ...nextHookDescRunnerParam,
              pageScope: makeSafeScope(nextHookDescRunnerParam.pageScope),
              hookScope: makeSafeScope(nextHookDescRunnerParam.hookScope),
            },
            errorHandler: (error: Event) => {
              return errorHandler(error, [pageScope]);
            },
            context: getContext(),
          }]);
        }
      });
    });
  }

  // 新启用hook，如果有页面，则先卸载页面，更新配置
  if (lifecycleHook === LifecycleHookEnum.beforeRouting) {
    enabledHookDescRunnerParams.forEach(({ hookScope }) => {
      const scopeHooks = getScopeHooks(hookScope.scopeName);
      scopeHooks.forEach(({ hookDescEntity, opts }) => {
        const hookPageConfig = hookDescEntity(LifecycleHookEnum.page) as PageConfig;
        if (hookPageConfig) {
          const hookPageName = getScopeName({ hookName: hookPageConfig.hookName });
          const hookPageScope = getScope(hookPageName);
          // 更新配置
          if (opts?.page && hookPageScope?.page) {
            hookPageScope.page.setConfig(opts.page);
          }
          // 卸载页面
          const hookPageStatus = getAppStatus(hookPageName);
          if (hookPageStatus && ['NOT_LOADED', 'UNLOADING'].indexOf(hookPageStatus) === -1) {
            unloadApplication(hookPageName);
          }
        }
      });
    });
  }

  // 启用hook，调用exec
  enabledHookDescRunnerParams.forEach(({ pageScope, hookScope }) => {
    const scopeHooks = getScopeHooks(hookScope.scopeName);
    scopeHooks.forEach(({ hookDescEntity, opts, hookName }) => {
      const hookDescRunner = hookDescEntity(lifecycleHook);
      if (hookDescRunner && 'exec' in hookDescRunner) {
        const hookPageConfig = hookDescEntity(LifecycleHookEnum.page) as PageConfig;
        let hookPageScope: HookScope;
        if (hookPageConfig) {
          const hookPageScopeName = getScopeName({ hookName: hookPageConfig.hookName });
          hookPageScope = getScope(hookPageScopeName);
        }

        scopeHooksRunners.push([hookDescRunner.exec, {
          ...props,
          hookName,
          pageScope: makeSafeScope(pageScope),
          hookScope: makeSafeScope(hookScope),
          hookPageScope: makeSafeScope(hookPageScope),
          opts,
          matched: true,
          hookPages,
          activePages,
          errorHandler: (error: Event) => {
            return errorHandler(error, [pageScope]);
          },
          context: getContext(),
        }]);
      }
    });
  });

  const continues: boolean[] = [];
  await scopeHooksRunners.reduce<Promise<any>>((p, scopeHooksRunner) => {
    const [runner, opts] = scopeHooksRunner;
    return p.then(() => {
      // console.log('hook runner before', lifecycleHook, opts);
      return runner(opts);
    }).then((isContinue) => {
      continues.push(isContinue);
      // console.log('hooke runner after', lifecycleHook, isContinue, opts);
    }).catch((error) => {
      console.warn(error);
    });
  }, Promise.resolve());

  if (continues.find((i) => i === false) === false) {
    return false;
  }

  return true;
}
