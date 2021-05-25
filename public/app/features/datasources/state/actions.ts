import { DataSourcePluginMeta, DataSourceSettings, locationUtil } from '@grafana/data';
import { DataSourceWithBackend, getDataSourceSrv, locationService } from '@grafana/runtime';
import { updateNavIndex } from 'app/core/actions';
import { getBackendSrv } from 'app/core/services/backend_srv';
import { getDatasourceSrv } from 'app/features/plugins/datasource_srv';
import { importDataSourcePlugin } from 'app/features/plugins/plugin_loader';
import { getPluginSettings } from 'app/features/plugins/PluginSettingsCache';
import { DataSourcePluginCategory, ThunkDispatch, ThunkResult } from 'app/types';

import config from '../../../core/config';

import { buildCategories } from './buildCategories';
import { buildNavModel } from './navModel';
import {
  dataSourceLoaded,
  dataSourceMetaLoaded,
  dataSourcePluginsLoad,
  dataSourcePluginsLoaded,
  dataSourcesLoaded,
  initDataSourceSettingsFailed,
  initDataSourceSettingsSucceeded,
  testDataSourceFailed,
  testDataSourceStarting,
  testDataSourceSucceeded,
} from './reducers';
import { getDataSource, getDataSourceMeta } from './selectors';

export interface DataSourceTypesLoadedPayload {
  plugins: DataSourcePluginMeta[];
  categories: DataSourcePluginCategory[];
}

export interface InitDataSourceSettingDependencies {
  loadDataSource: typeof loadDataSource;
  getDataSource: typeof getDataSource;
  getDataSourceMeta: typeof getDataSourceMeta;
  importDataSourcePlugin: typeof importDataSourcePlugin;
}

export interface TestDataSourceDependencies {
  getDatasourceSrv: typeof getDataSourceSrv;
  getBackendSrv: typeof getBackendSrv;
}

export const initDataSourceSettings = (
  pageId: string,
  dependencies: InitDataSourceSettingDependencies = {
    loadDataSource,
    getDataSource,
    getDataSourceMeta,
    importDataSourcePlugin,
  }
): ThunkResult<void> => {
  return async (dispatch, getState) => {
    if (!pageId) {
      dispatch(initDataSourceSettingsFailed(new Error('Invalid ID')));
      return;
    }

    try {
      await dispatch(dependencies.loadDataSource(pageId));

      // have we already loaded the plugin then we can skip the steps below?
      if (getState().dataSourceSettings.plugin) {
        return;
      }

      const dataSource = dependencies.getDataSource(getState().dataSources, pageId);
      const dataSourceMeta = dependencies.getDataSourceMeta(getState().dataSources, dataSource!.type);
      const importedPlugin = await dependencies.importDataSourcePlugin(dataSourceMeta);

      dispatch(initDataSourceSettingsSucceeded(importedPlugin));
    } catch (err) {
      console.error('Failed to import plugin module', err);
      dispatch(initDataSourceSettingsFailed(err));
    }
  };
};

export const testDataSource = (
  dataSourceName: string,
  dependencies: TestDataSourceDependencies = {
    getDatasourceSrv,
    getBackendSrv,
  }
): ThunkResult<void> => {
  return async (dispatch: ThunkDispatch, getState) => {
    const dsApi = await dependencies.getDatasourceSrv().get(dataSourceName);

    if (!dsApi.testDatasource) {
      return;
    }

    dispatch(testDataSourceStarting());

    dependencies.getBackendSrv().withNoBackendCache(async () => {
      try {
        const result = await dsApi.testDatasource();

        dispatch(testDataSourceSucceeded(result));
      } catch (err) {
        const { statusText, message: errMessage, details } = err;
        const message = statusText ? 'HTTP error ' + statusText : errMessage;

        dispatch(testDataSourceFailed({ message, details }));
      }
    });
  };
};

export function loadDataSources(): ThunkResult<void> {
  return async (dispatch) => {
    const response = await getBackendSrv().get('/api/datasources');
    dispatch(dataSourcesLoaded(response));
  };
}

export function loadDataSource(uid: string): ThunkResult<void> {
  return async (dispatch) => {
    const dataSource = await getDataSourceUsingUidOrId(uid);
    const pluginInfo = (await getPluginSettings(dataSource.type)) as DataSourcePluginMeta;
    const plugin = await importDataSourcePlugin(pluginInfo);
    const isBackend = plugin.DataSourceClass.prototype instanceof DataSourceWithBackend;
    const meta = {
      ...pluginInfo,
      isBackend: isBackend,
    };
    dispatch(dataSourceLoaded(dataSource));
    dispatch(dataSourceMetaLoaded(meta));

    plugin.meta = meta;
    dispatch(updateNavIndex(buildNavModel(dataSource, plugin)));
  };
}

/**
 * Get data source by uid or id, if old id detected handles redirect
 */
async function getDataSourceUsingUidOrId(uid: string): Promise<DataSourceSettings> {
  // Try first with uid api
  try {
    const byUid = await getBackendSrv()
      .fetch<DataSourceSettings>({
        method: 'GET',
        url: `/api/datasources/uid/${uid}`,
        showErrorAlert: false,
      })
      .toPromise();

    if (byUid.ok) {
      return byUid.data;
    }
  } catch (err) {
    console.log('Failed to lookup data source by uid', err);
  }

  // try lookup by old db id
  const id = parseInt(uid, 10);
  if (!Number.isNaN(id)) {
    const response = await getBackendSrv()
      .fetch<DataSourceSettings>({
        method: 'GET',
        url: `/api/datasources/${id}`,
        showErrorAlert: false,
      })
      .toPromise();

    // Not ideal to do a full page reload here but so tricky to handle this
    // otherwise We can update the location using react router, but need to
    // fully reload the route as the nav model page index is not matching with
    // the url in that case. And react router has no way to unmount remount a
    // route
    if (response.ok && response.data.id.toString() === uid) {
      window.location.href = locationUtil.assureBaseUrl(`/datasources/edit/${response.data.uid}`);
      return {} as DataSourceSettings; // avoids flashing an error
    }
  }

  throw Error('Could not find data source');
}

export function addDataSource(plugin: DataSourcePluginMeta): ThunkResult<void> {
  return async (dispatch, getStore) => {
    await dispatch(loadDataSources());

    const dataSources = getStore().dataSources.dataSources;

    const newInstance = {
      name: plugin.name,
      type: plugin.id,
      access: 'proxy',
      isDefault: dataSources.length === 0,
    };

    if (nameExits(dataSources, newInstance.name)) {
      newInstance.name = findNewName(dataSources, newInstance.name);
    }

    const result = await getBackendSrv().post('/api/datasources', newInstance);
    locationService.push(`/datasources/edit/${result.datasource.uid}`);
  };
}

export function loadDataSourcePlugins(): ThunkResult<void> {
  return async (dispatch) => {
    dispatch(dataSourcePluginsLoad());
    const plugins = await getBackendSrv().get('/api/plugins', { enabled: 1, type: 'datasource' });
    const categories = buildCategories(plugins);
    dispatch(dataSourcePluginsLoaded({ plugins, categories }));
  };
}

export function updateDataSource(dataSource: DataSourceSettings): ThunkResult<void> {
  return async (dispatch) => {
    await getBackendSrv().put(`/api/datasources/${dataSource.id}`, dataSource); // by UID not yet supported
    await updateFrontendSettings();
    return dispatch(loadDataSource(dataSource.uid));
  };
}

export function deleteDataSource(id?: number, fetch = false): ThunkResult<void> {
  return async (dispatch, getStore) => {
    id = id || getStore().dataSources.dataSource.id;

    await getBackendSrv().delete(`/api/datasources/${id}`);
    await updateFrontendSettings();

    locationService.push('/datasources');

    if (fetch) {
      return dispatch(loadDataSources());
    }
  };
}

interface ItemWithName {
  name: string;
}

export function nameExits(dataSources: ItemWithName[], name: string) {
  return (
    dataSources.filter((dataSource) => {
      return dataSource.name.toLowerCase() === name.toLowerCase();
    }).length > 0
  );
}

export function findNewName(dataSources: ItemWithName[], name: string) {
  // Need to loop through current data sources to make sure
  // the name doesn't exist
  while (nameExits(dataSources, name)) {
    // If there's a duplicate name that doesn't end with '-x'
    // we can add -1 to the name and be done.
    if (!nameHasSuffix(name)) {
      name = `${name}-1`;
    } else {
      // if there's a duplicate name that ends with '-x'
      // we can try to increment the last digit until the name is unique

      // remove the 'x' part and replace it with the new number
      name = `${getNewName(name)}${incrementLastDigit(getLastDigit(name))}`;
    }
  }

  return name;
}

function updateFrontendSettings() {
  return getBackendSrv()
    .get('/api/frontend/settings')
    .then((settings: any) => {
      config.datasources = settings.datasources;
      config.defaultDatasource = settings.defaultDatasource;
      getDatasourceSrv().init(config.datasources, settings.defaultDatasource);
    });
}

function nameHasSuffix(name: string) {
  return name.endsWith('-', name.length - 1);
}

function getLastDigit(name: string) {
  return parseInt(name.slice(-1), 10);
}

function incrementLastDigit(digit: number) {
  return isNaN(digit) ? 1 : digit + 1;
}

function getNewName(name: string) {
  return name.slice(0, name.length - 1);
}
