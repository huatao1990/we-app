import Page, { PageConfig } from './page';
import Product from './product';
import Base, { BaseConfig, BaseType } from './base';
import { getPageName } from '../helpers';
import { HookScope } from '../hooks/type';

export interface WeAppConfig extends BaseConfig {
  parent?: Product;

  url?: string;

  pages?: PageConfig[];

  filterPages?: (cfgs: PageConfig|PageConfig[]) => PageConfig|PageConfig[]|undefined;

  [prop: string]: any;
}

// 已注册页面都记录在这里
// 主要用于首次访问时获取activeScopes
let registedPages: Page[] = [];

export default class WeApp extends Base {
  type: BaseType = BaseType.weApp;

  parent: Product;

  constructor(config: WeAppConfig) {
    super(config);

    if (config) {
      this.registerPages(config.pages);
    }
  }

  async registerPages(configs: PageConfig[] = []) {
    const cfgs = this.filterPages(configs) as PageConfig[];
    if (cfgs) {
      const pages = await this.registerChildren(cfgs, Page) as Page[];
      registedPages = registedPages.concat(pages);
      return pages;
    }
  }

  async registerPage(cfg: PageConfig) {
    const config = this.filterPages(cfg) as PageConfig;
    if (config) {
      const page = await this.registerChild(config, Page) as Page;
      page && registedPages.push(page);
      return page;
    }
  }

  filterPages(cfgs: PageConfig|PageConfig[]) {
    const filter = this.getConfig('filterPages') as WeAppConfig['filterPages'];
    if (filter && typeof filter === 'function') {
      return filter(cfgs);
    }
    return cfgs;
  }

  getPage(pageName: string) {
    return this.getChild(pageName) as Page;
  }
}

export function getActiveScopes(location: Location, excludePageNames: string[] = []) {
  const activeScopes: HookScope<any>[] = [];
  const activeFns = registedPages.filter((page) => {
    const scope = page.compoundScope(page);
    const pageName = getPageName(scope);
    return excludePageNames.indexOf(pageName) === -1;
  }).map((page) => {
    return {
      page,
      activeFn: page.makeActivityFunction(),
    };
  });
  activeFns.forEach(({ page, activeFn }) => {
    if (activeFn(location)) {
      activeScopes.push(page.compoundScope(page));
    }
  });
  return activeScopes;
}
