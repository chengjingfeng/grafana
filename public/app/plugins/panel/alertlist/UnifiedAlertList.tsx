import React, { useEffect, useMemo } from 'react';
import { sortBy } from 'lodash';
import { useDispatch } from 'react-redux';
import { GrafanaTheme, GrafanaTheme2, intervalToAbbreviatedDurationString, PanelProps } from '@grafana/data';
import { CustomScrollbar, LoadingPlaceholder, useStyles, useStyles2 } from '@grafana/ui';
import { css, cx } from '@emotion/css';

import alertDef from 'app/features/alerting/state/alertDef';
import { SortOrder, UnifiedAlertlistOptions } from './types';

import { flattenRules, alertStateToState, getFirstActiveAt } from 'app/features/alerting/unified/utils/rules';
import { PromRuleWithLocation } from 'app/types/unified-alerting';
import { fetchAllPromRulesAction } from 'app/features/alerting/unified/state/actions';
import { useUnifiedAlertingSelector } from 'app/features/alerting/unified/hooks/useUnifiedAlertingSelector';
import { getAllRulesSourceNames } from 'app/features/alerting/unified/utils/datasource';
import { getDashboardSrv } from 'app/features/dashboard/services/DashboardSrv';
import { Annotation } from 'app/features/alerting/unified/utils/constants';
import { PromAlertingRuleState } from 'app/types/unified-alerting-dto';

const ALERT_LIST_POLL_INTERVAL_MS = 60000;

export function UnifiedAlertList(props: PanelProps<UnifiedAlertlistOptions>) {
  const dispatch = useDispatch();
  const rulesDataSourceNames = useMemo(getAllRulesSourceNames, []);

  useEffect(() => {
    dispatch(fetchAllPromRulesAction());
    const interval = setInterval(() => dispatch(fetchAllPromRulesAction()), ALERT_LIST_POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [dispatch]);

  const promRulesRequests = useUnifiedAlertingSelector((state) => state.promRules);

  const dispatched = rulesDataSourceNames.some((name) => promRulesRequests[name]?.dispatched);
  const loading = rulesDataSourceNames.some((name) => promRulesRequests[name]?.loading);
  const haveResults = rulesDataSourceNames.some(
    (name) => promRulesRequests[name]?.result?.length && !promRulesRequests[name]?.error
  );

  const styles = useStyles(getStyles);
  const stateStyle = useStyles2(getStateTagStyles);

  const rules = filterRules(
    props.options,
    sortRules(
      props.options.sortOrder,
      haveResults
        ? Object.values(promRulesRequests).flatMap(({ result = [] }) => {
            return flattenRules(result);
          })
        : []
    )
  );

  const rulesToDisplay = rules.length <= props.options.maxItems ? rules : rules.slice(0, props.options.maxItems);

  const noAlertsMessage = rules.length ? '' : 'No alerts';

  return (
    <CustomScrollbar autoHeightMin="100%" autoHeightMax="100%">
      <div className={styles.container}>
        {dispatched && loading && !haveResults && <LoadingPlaceholder text="Loading..." />}
        {noAlertsMessage && <div className={styles.noAlertsMessage}>{noAlertsMessage}</div>}
        <section>
          <ol className={styles.alertRuleList}>
            {haveResults &&
              rulesToDisplay.map((rule, index) => {
                const firstActiveAt = getFirstActiveAt(rule);
                return (
                  <li
                    className={styles.alertRuleItem}
                    key={`alert-${rule.namespaceName}-${rule.groupName}-${rule.name}-${index}`}
                  >
                    <div className={cx(stateStyle[alertStateToState[rule.state]], stateStyle.common)}>
                      <span>{rule.state}</span>
                    </div>
                    <div className={styles.instanceDetails}>
                      <div className={styles.alertName} title={rule.name}>
                        {rule.name}
                      </div>
                      {rule.state !== PromAlertingRuleState.Inactive && (
                        <>
                          <div className={styles.alertDuration}>
                            <span className={stateStyle[`${alertStateToState[rule.state]}Text` as const]}>
                              {rule.state.toUpperCase()}
                            </span>{' '}
                            {firstActiveAt && (
                              <>
                                for{' '}
                                <span>
                                  {intervalToAbbreviatedDurationString({
                                    start: firstActiveAt,
                                    end: Date.now(),
                                  })}
                                </span>
                              </>
                            )}
                          </div>
                          <div className={styles.alertRuleItemText}>
                            <span>{`${rule.alerts.length} instances`}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
          </ol>
        </section>
      </div>
    </CustomScrollbar>
  );
}

function sortRules(sortOrder: SortOrder, rules: PromRuleWithLocation[]) {
  if (sortOrder === SortOrder.Importance) {
    // @ts-ignore
    return sortBy(rules, (rule) => alertDef.alertStateSortScore[rule.state]);
  } else if (sortOrder === SortOrder.TimeAsc) {
    return sortBy(rules, (rule) => getFirstActiveAt(rule) || new Date());
  } else if (sortOrder === SortOrder.TimeDesc) {
    return sortBy(rules, (rule) => getFirstActiveAt(rule) || new Date()).reverse();
  }

  const result = sortBy(rules, (rule) => rule.name.toLowerCase());
  if (sortOrder === SortOrder.AlphaDesc) {
    result.reverse();
  }

  return result;
}

function filterRules(options: PanelProps<UnifiedAlertlistOptions>['options'], rules: PromRuleWithLocation[]) {
  let filteredRules = [...rules];
  if (options.dashboardAlerts) {
    const dashboardUid = getDashboardSrv().getCurrent()?.uid;
    filteredRules = filteredRules.filter(({ annotations = {} }) =>
      Object.entries(annotations).some(([key, value]) => key === Annotation.dashboardUID && value === dashboardUid)
    );
  }
  if (Object.values(options.stateFilter).some((value) => value)) {
    filteredRules = filteredRules.filter((rule) => {
      return (
        (options.stateFilter.firing && rule.state === PromAlertingRuleState.Firing) ||
        (options.stateFilter.pending && rule.state === PromAlertingRuleState.Pending) ||
        (options.stateFilter.inactive && rule.state === PromAlertingRuleState.Inactive)
      );
    });
  }

  return filteredRules;
}

const getStyles = (theme: GrafanaTheme) => ({
  cardContainer: css`
    padding: ${theme.spacing.xs} 0 ${theme.spacing.xxs} 0;
    line-height: ${theme.typography.lineHeight.md};
    margin-bottom: 0px;
  `,
  container: css`
    overflow-y: auto;
    height: 100%;
  `,
  alertRuleList: css`
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    list-style-type: none;
  `,
  alertRuleItem: css`
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
    background: ${theme.colors.bg2};
    padding: ${theme.spacing.xs} ${theme.spacing.sm};
    border-radius: ${theme.border.radius.md};
    margin-bottom: ${theme.spacing.xs};

    & > * {
      margin-right: ${theme.spacing.sm};
    }
  `,
  alertName: css`
    font-size: ${theme.typography.size.md};
    font-weight: ${theme.typography.weight.bold};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  alertDuration: css`
    font-size: ${theme.typography.size.sm};
  `,
  alertRuleItemText: css`
    font-weight: ${theme.typography.weight.bold};
    font-size: ${theme.typography.size.sm};
    margin: 0;
  `,
  alertRuleItemTime: css`
    color: ${theme.colors.textWeak};
    font-weight: normal;
    white-space: nowrap;
  `,
  alertRuleItemInfo: css`
    font-weight: normal;
    flex-grow: 2;
    display: flex;
    align-items: flex-end;
  `,
  noAlertsMessage: css`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  `,
  alertIcon: css`
    margin-right: ${theme.spacing.xs};
  `,
  instanceDetails: css`
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
});

const getStateTagStyles = (theme: GrafanaTheme2) => ({
  common: css`
    width: 70px;
    text-align: center;
    align-self: stretch;

    display: inline-block;
    color: white;
    border-radius: ${theme.shape.borderRadius()};
    font-size: ${theme.typography.size.sm};
    /* padding: ${theme.spacing(2, 0)}; */
    text-transform: capitalize;
    line-height: 1.2;
    flex-shrink: 0;

    display: flex;
    flex-direction: column;
    justify-content: center;
  `,
  good: css`
    background-color: ${theme.colors.success.main};
    border: solid 1px ${theme.colors.success.main};
    color: ${theme.colors.success.contrastText};
  `,
  warning: css`
    background-color: ${theme.colors.warning.main};
    border: solid 1px ${theme.colors.warning.main};
    color: ${theme.colors.warning.contrastText};
  `,
  bad: css`
    background-color: ${theme.colors.error.main};
    border: solid 1px ${theme.colors.error.main};
    color: ${theme.colors.error.contrastText};
  `,
  neutral: css`
    background-color: ${theme.colors.secondary.main};
    border: solid 1px ${theme.colors.secondary.main};
  `,
  info: css`
    background-color: ${theme.colors.primary.main};
    border: solid 1px ${theme.colors.primary.main};
    color: ${theme.colors.primary.contrastText};
  `,
  goodText: css`
    color: ${theme.colors.success.main};
  `,
  badText: css`
    color: ${theme.colors.error.main};
  `,
  warningText: css`
    color: ${theme.colors.warning.main};
  `,
  neutralText: css`
    color: ${theme.colors.secondary.main};
  `,
  infoText: css`
    color: ${theme.colors.primary.main};
  `,
});
