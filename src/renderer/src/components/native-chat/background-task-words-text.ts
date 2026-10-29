// Translate whole shared pieces with shared English fallbacks so desktop and mobile roster wording agree.

import { translate } from '@/i18n/i18n'
import {
  BACKGROUND_TASK_COPY as COPY,
  type BackgroundTaskCopyId,
  type BackgroundTaskCopyValues,
  type BackgroundTaskSay
} from '../../../../shared/background-task-copy'

const PIECES: Record<BackgroundTaskCopyId, (values?: BackgroundTaskCopyValues) => string> = {
  monitoring: () => translate('components.native-chat.backgroundTasks.monitoring', COPY.monitoring),
  stop: () => translate('components.native-chat.backgroundTasks.stop', COPY.stop),
  stopTask: (values) =>
    translate('components.native-chat.backgroundTasks.stopTask', COPY.stopTask, values),
  stopAll: () => translate('components.native-chat.backgroundTasks.stopAll', COPY.stopAll),
  agent: () => translate('components.native-chat.backgroundTasks.agent', COPY.agent),
  workflow: () => translate('components.native-chat.backgroundTasks.workflow', COPY.workflow),
  command: () => translate('components.native-chat.backgroundTasks.command', COPY.command),
  monitor: () => translate('components.native-chat.backgroundTasks.monitor', COPY.monitor),
  task: () => translate('components.native-chat.backgroundTasks.task', COPY.task),
  detailsUnavailable: () =>
    translate('components.native-chat.backgroundTasks.detailsUnavailable', COPY.detailsUnavailable),
  countAgents: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.backgroundTasks.countAgents_one',
          COPY.countAgents.one,
          values
        )
      : translate(
          'components.native-chat.backgroundTasks.countAgents_other',
          COPY.countAgents.other,
          values
        ),
  countShell: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.backgroundTasks.countShell_one',
          COPY.countShell.one,
          values
        )
      : translate(
          'components.native-chat.backgroundTasks.countShell_other',
          COPY.countShell.other,
          values
        ),
  countShellCommandOne: () =>
    translate(
      'components.native-chat.backgroundTasks.countShellCommandOne',
      COPY.countShellCommandOne
    ),
  countMonitors: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.backgroundTasks.countMonitors_one',
          COPY.countMonitors.one,
          values
        )
      : translate(
          'components.native-chat.backgroundTasks.countMonitors_other',
          COPY.countMonitors.other,
          values
        ),
  countWorkflows: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.backgroundTasks.countWorkflows_one',
          COPY.countWorkflows.one,
          values
        )
      : translate(
          'components.native-chat.backgroundTasks.countWorkflows_other',
          COPY.countWorkflows.other,
          values
        ),
  countTasks: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.backgroundTasks.countTasks_one',
          COPY.countTasks.one,
          values
        )
      : translate(
          'components.native-chat.backgroundTasks.countTasks_other',
          COPY.countTasks.other,
          values
        ),
  headerTotal: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.backgroundTasks.headerTotal_one',
          COPY.headerTotal.one,
          values
        )
      : translate(
          'components.native-chat.backgroundTasks.headerTotal_other',
          COPY.headerTotal.other,
          values
        ),
  stateWorking: () =>
    translate('components.native-chat.backgroundTasks.stateWorking', COPY.stateWorking),
  stateWorkingCount: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.backgroundTasks.stateWorkingCount_one',
          COPY.stateWorkingCount.one,
          values
        )
      : translate(
          'components.native-chat.backgroundTasks.stateWorkingCount_other',
          COPY.stateWorkingCount.other,
          values
        ),
  stateMonitoring: () =>
    translate('components.native-chat.backgroundTasks.stateMonitoring', COPY.stateMonitoring),
  stateMonitoringCount: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.backgroundTasks.stateMonitoringCount_one',
          COPY.stateMonitoringCount.one,
          values
        )
      : translate(
          'components.native-chat.backgroundTasks.stateMonitoringCount_other',
          COPY.stateMonitoringCount.other,
          values
        ),
  stateWaiting: () =>
    translate('components.native-chat.backgroundTasks.stateWaiting', COPY.stateWaiting),
  stateWaitingCount: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.backgroundTasks.stateWaitingCount_one',
          COPY.stateWaitingCount.one,
          values
        )
      : translate(
          'components.native-chat.backgroundTasks.stateWaitingCount_other',
          COPY.stateWaitingCount.other,
          values
        ),
  stateBlocked: () =>
    translate('components.native-chat.backgroundTasks.stateBlocked', COPY.stateBlocked),
  stateBlockedCount: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.backgroundTasks.stateBlockedCount_one',
          COPY.stateBlockedCount.one,
          values
        )
      : translate(
          'components.native-chat.backgroundTasks.stateBlockedCount_other',
          COPY.stateBlockedCount.other,
          values
        ),
  stateDone: () => translate('components.native-chat.backgroundTasks.stateDone', COPY.stateDone),
  stateDoneCount: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.backgroundTasks.stateDoneCount_one',
          COPY.stateDoneCount.one,
          values
        )
      : translate(
          'components.native-chat.backgroundTasks.stateDoneCount_other',
          COPY.stateDoneCount.other,
          values
        ),
  stateIdle: () => translate('components.native-chat.backgroundTasks.stateIdle', COPY.stateIdle),
  stateIdleCount: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.backgroundTasks.stateIdleCount_one',
          COPY.stateIdleCount.one,
          values
        )
      : translate(
          'components.native-chat.backgroundTasks.stateIdleCount_other',
          COPY.stateIdleCount.other,
          values
        ),
  stateUnverifiable: () =>
    translate('components.native-chat.backgroundTasks.stateUnverifiable', COPY.stateUnverifiable),
  stateUnverifiableCount: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.backgroundTasks.stateUnverifiableCount_one',
          COPY.stateUnverifiableCount.one,
          values
        )
      : translate(
          'components.native-chat.backgroundTasks.stateUnverifiableCount_other',
          COPY.stateUnverifiableCount.other,
          values
        ),
  reasonWaiting: () =>
    translate('components.native-chat.backgroundTasks.reasonWaiting', COPY.reasonWaiting),
  reasonBlocked: () =>
    translate('components.native-chat.backgroundTasks.reasonBlocked', COPY.reasonBlocked),
  groupAgents: () =>
    translate('components.native-chat.backgroundTasks.groupAgents', COPY.groupAgents),
  groupShell: () => translate('components.native-chat.backgroundTasks.groupShell', COPY.groupShell),
  groupMonitors: () =>
    translate('components.native-chat.backgroundTasks.groupMonitors', COPY.groupMonitors),
  groupWorkflows: () =>
    translate('components.native-chat.backgroundTasks.groupWorkflows', COPY.groupWorkflows),
  groupTasks: () => translate('components.native-chat.backgroundTasks.groupTasks', COPY.groupTasks)
}

export const sayBackgroundTaskTranslated: BackgroundTaskSay = (id, values) => PIECES[id](values)
