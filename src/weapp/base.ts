import get from 'lodash-es/get';
import { HookScope } from '../hooks/type';
import { specifyHooks } from '../hooks';
import { UseHooksParams } from '../hooks/hooks';
import { ResourceLoader } from '../resource-loader';
import Product from './product';
import Deferred from '../utils/deferred';

export interface Render {
  mount: (element: any, container?: HTMLElement, opts?: HookScope<any>) => any;
  unmount: (container?: HTMLElement, opts?: HookScope<any>) => any;
}

export interface BaseConfig {
  name?: string;
  type?: BaseType;
  parent?: Base;

  hooks?: boolean | UseHooksParams;

  render?: Render;

  resourceLoader?: ResourceLoader;
  basicLibs?: string[];
  useSystem?: string[];

  [prop: string]: any;
}

export enum BaseType {
  root = 'root',
  product = 'product',
  weApp = 'weApp',
  page = 'page'
}

function compoundScope(base: Base, scope: HookScope<any> = {}): HookScope<any> {
  if (base.type === BaseType.root) {
    if (!scope.product) {
      scope.product = base as Product;
    }
    return scope;
  }

  scope[`${base.type}Name`] = base.name;
  scope[base.type as string] = base;

  return compoundScope(base.parent, scope);
}

export default class Base {
  type: BaseType;

  name: string;

  parent: Base;

  compoundScope = compoundScope;

  private children: Base[] = [];

  private config: BaseConfig;

  private sandbox?: Window;

  private data: object = {};

  private isStarted: boolean = false;

  private initDeferred: Deferred<Base>;

  constructor(config?: BaseConfig) {
    if (config) {
      this.name = config.name;
      this.parent = config.parent;

      if (config.hooks) {
        specifyHooks(config.hooks, compoundScope(this));
      }

      this.config = config;
    }
  }

  // 执行
  start() {
    if (this.isStarted) {
      return;
    }
    this.isStarted = true;

    this.children.forEach((child) => {
      child.start();
    });
  }

  getInited() {
    return this.initDeferred?.promise;
  }

  async requireChildrenInited() {
    const pInited: Promise<any>[] = [];

    const pSelfInited = this.getInited();

    if (pSelfInited) {
      pInited.push(pSelfInited);
    } else if (this.children) {
      this.children.forEach((child) => {
        // 为undefined，则直接向下一级探索
        const pChildInited = child.getInited();
        if (pChildInited) {
          pInited.push(pChildInited);
        } else {
          const pChildrenInited = child.requireChildrenInited();
          pInited.push(pChildrenInited);
        }
      });
    }

    const initStatus = await Promise.all(pInited);
    return initStatus;
  }

  getConfig(pathname?: string) {
    let config = pathname ? get(this.config, pathname) : this.config;
    if (!config && this.type !== BaseType.root) {
      config = this.parent.getConfig(pathname);
    }
    return config;
  }

  setConfig(config: BaseConfig) {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  getSkeletonContainer(traced = false) {
    return this.getData('skeletonContainer', traced);
  }

  setSkeletonContainer(skeletonContainer: HTMLElement|Element) {
    this.setData('skeletonContainer', skeletonContainer);
  }

  getRender() {
    const render = this.getConfig('render') as Render;
    if (render) {
      let renderWrapper = render;
      if (this.type === BaseType.page) {
        // @ts-ignore
        const container = this.getPageContainer();
        renderWrapper = {
          mount: (element, node, opts) => {
            render.mount(element, node || container, opts);
          },
          unmount: (node, opts) => {
            render.unmount(node || container, opts);
          },
        };
      }
      return renderWrapper;
    }
  }

  getData(pathname: string, traced = false) {
    if (!pathname) {
      return;
    }

    let data = get(this.data, pathname);
    if (traced && !data && this.type !== BaseType.root) {
      data = this.parent.getData(pathname);
    }
    return data;
  }

  setData(pathname: string|symbol|object, data?: any) {
    if (typeof pathname === 'object') {
      this.data = {
        ...this.data,
        ...pathname,
      };
      return;
    }

    this.data[pathname] = data;
  }

  specifyHooks(params: boolean|UseHooksParams) {
    specifyHooks(params, compoundScope(this));
  }

  protected async registerChildren(cfgs: BaseConfig[], Child: typeof Base) {
    const pChildren = cfgs.map((config) => this.registerChild(config, Child));
    const children = await Promise.all(pChildren);
    return children.filter((child) => child);
  }

  protected async registerChild(config: BaseConfig, Child: typeof Base) {
    let child = this.getChild(config.name);
    if (child) {
      return child;
    }

    child = new Child({
      ...config,
      parent: this,
    });

    this.children.push(child);

    return child;
  }

  protected setInitDeferred() {
    if (!this.initDeferred || this.initDeferred.finished()) {
      this.initDeferred = new Deferred();
    }
  }

  protected setInited() {
    this.setInitDeferred();
    this.initDeferred.resolve(this);
  }

  protected getChild(name: string) {
    const child = this.children.find(c => c.name === name);
    return child;
  }
}
