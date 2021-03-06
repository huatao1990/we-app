/**
 * 骨架必须在路由切换前确定是显示还是隐藏
 * 页面容器在路由切换前显示，在卸载后隐藏
 */
import { HookDesc, HookDescRunnerParam, HookOpts, UsingHookOpts } from '../type';

export interface HookSkeletonOpts extends HookOpts {
  template: string;
  container: HTMLElement;
  contentSelector: string;
  [prop: string]: any;
}

const hookSkeletonDesc: HookDesc<HookSkeletonOpts> = {
  beforeRouting: {
    exec: async (param: HookDescRunnerParam<HookSkeletonOpts>) => {
      const { hookScope } = param;

      // 渲染骨架
      let { opts: { container } } = param;
      const { opts: { template, contentSelector } } = param;

      if (!hookScope.getData('skeletonContainer')) {
        const div = document.createElement('div');
        div.innerHTML = template;
        const skeletonContainer = div.children[0];

        const df = document.createDocumentFragment();
        df.appendChild(skeletonContainer);

        if (!container) {
          // 回溯到父骨架
          container = hookScope.getData('contentContainer', true) as HTMLElement;
        }

        container.appendChild(df);

        hookScope.setData('skeletonContainer', skeletonContainer);

        const contentContainer = skeletonContainer.querySelector(contentSelector);
        hookScope.setData('contentContainer', contentContainer);
      }
    },
    clear: async (param: HookDescRunnerParam<HookSkeletonOpts>) => {
      const { hookScope, nextHookDescRunnerParam } = param;
      const { hookScope: nextHookScope } = nextHookDescRunnerParam;

      const elSkeleton = hookScope.getData('skeletonContainer') as HTMLElement;

      let { opts: { container } } = param;
      // 需要处理取父骨架的情况，取父骨架的内容区
      if (!container) {
        // 回溯到父骨架
        container = hookScope.getData('contentContainer', true) as HTMLElement;
      }

      if (!nextHookScope) {
        container.removeChild(elSkeleton);
        return;
      }

      // 跨产品时，是否需要隐藏当前skeleton
      // 当是父子关系时，父级不可清除
      // 不为父子关系则清除
      if (nextHookScope.getData('skeletonContainer', true) as HTMLElement !== elSkeleton) {
        container.removeChild(elSkeleton);
      }
    },
  },
};

const hookSkeleton: UsingHookOpts<HookSkeletonOpts> = {
  hookName: 'skeleton',
  hookDesc: hookSkeletonDesc,
};

export default hookSkeleton;
