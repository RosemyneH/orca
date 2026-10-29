// Translate shared roster phrases whole with shared English fallbacks to keep desktop/mobile wording aligned.

import { translate } from '@/i18n/i18n'
import {
  NATIVE_CHAT_SUBAGENT_GROUP_COPY as COPY,
  type NativeChatSubagentGroupCopyId,
  type NativeChatSubagentGroupSay
} from '../../../../shared/native-chat/transcript/native-chat-subagent-group-header'
import type { CopyValues } from '../../../../shared/counted-copy-english'

const PIECES: Record<NativeChatSubagentGroupCopyId, (values?: CopyValues) => string> = {
  stateCompleted: () =>
    translate('components.native-chat.subagents.state.completed', COPY.stateCompleted),
  stateWorking: () =>
    translate('components.native-chat.subagents.state.working', COPY.stateWorking),
  stateIdle: () => translate('components.native-chat.subagents.state.idle', COPY.stateIdle),
  stateFailed: () => translate('components.native-chat.subagents.state.failed', COPY.stateFailed),
  stateStopped: () =>
    translate('components.native-chat.subagents.state.stopped', COPY.stateStopped),
  stateUnverifiable: () =>
    translate('components.native-chat.subagents.state.unverifiable', COPY.stateUnverifiable),
  stateWorkingCount: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.subagents.state.workingCount_one',
          COPY.stateWorkingCount.one,
          values
        )
      : translate(
          'components.native-chat.subagents.state.workingCount_other',
          COPY.stateWorkingCount.other,
          values
        ),
  stateIdleCount: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.subagents.state.idleCount_one',
          COPY.stateIdleCount.one,
          values
        )
      : translate(
          'components.native-chat.subagents.state.idleCount_other',
          COPY.stateIdleCount.other,
          values
        ),
  stateFailedCount: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.subagents.state.failedCount_one',
          COPY.stateFailedCount.one,
          values
        )
      : translate(
          'components.native-chat.subagents.state.failedCount_other',
          COPY.stateFailedCount.other,
          values
        ),
  stateStoppedCount: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.subagents.state.stoppedCount_one',
          COPY.stateStoppedCount.one,
          values
        )
      : translate(
          'components.native-chat.subagents.state.stoppedCount_other',
          COPY.stateStoppedCount.other,
          values
        ),
  stateUnverifiableCount: (values) =>
    values?.count === 1
      ? translate(
          'components.native-chat.subagents.state.unverifiableCount_one',
          COPY.stateUnverifiableCount.one,
          values
        )
      : translate(
          'components.native-chat.subagents.state.unverifiableCount_other',
          COPY.stateUnverifiableCount.other,
          values
        ),
  started: (values) =>
    values?.count === 1
      ? translate('components.native-chat.subagents.started_one', COPY.started.one, values)
      : translate('components.native-chat.subagents.started_other', COPY.started.other, values),
  ran: (values) =>
    values?.count === 1
      ? translate('components.native-chat.subagents.ran_one', COPY.ran.one, values)
      : translate('components.native-chat.subagents.ran_other', COPY.ran.other, values),
  tokens: (values) => translate('components.native-chat.subagents.tokens', COPY.tokens, values)
}

export const sayNativeChatSubagentGroupTranslated: NativeChatSubagentGroupSay = (id, values) =>
  PIECES[id](values)
