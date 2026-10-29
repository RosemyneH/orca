import { translate, type Translate } from '../i18n/mobile-i18n'
import { mobileCommitDropdownCopy } from './mobile-commit-dropdown-copy'
import { mobileRemoteDropdownCopy } from './mobile-remote-dropdown-copy'
import type { GitConflictOperation } from '../../../src/shared/git-status-types'
import { deriveDropdownActionContext } from '../../../src/shared/source-control-dropdown-action-context'
import { buildCommitDropdownItems } from '../../../src/shared/source-control-dropdown-commit-items'
import type { DropdownItem } from '../../../src/shared/source-control-dropdown-item-types'
import { buildRemoteDropdownItems } from '../../../src/shared/source-control-dropdown-remote-items'
import type { SourceControlPrimaryActionDecisionInputs } from '../../../src/shared/source-control-primary-action-decision-types'

// String identifiers keep native lucide imports out of this module.
export type MobileSourceControlActionIcon =
  | 'commit'
  | 'push'
  | 'pull'
  | 'sync'
  | 'fetch'
  | 'publish'
  | 'rebase'
  | 'pr'
  | 'branch'
  | 'history'

export type MobileSourceControlAction = {
  id: string
  label: string
  iconKey: MobileSourceControlActionIcon
  disabled?: boolean
  hint?: string
  loading?: boolean
  skipAutoClose?: boolean
  onPress: () => void
}

export type MobileSourceControlActionArgs = {
  // The commit area's facts in desktop's shape, so rows enable and read exactly as desktop's menu.
  decision: SourceControlPrimaryActionDecisionInputs
  conflictOperation?: GitConflictOperation
  rebaseBaseRef: string | null
  busyAction: string | null
  openingPath: string | null
  openingBranchPath: string | null
  prAvailable: boolean
  prHint?: string
  forcePushBlockedReason?: string
  handlers: {
    commit: () => void
    commitPush: (forceWithLease: boolean) => void
    commitSync: () => void
    push: () => void
    forcePush: () => void
    pull: () => void
    sync: () => void
    fetch: () => void
    publish: () => void
    fastForward: () => void
    rebase: () => void
    createPr: () => void
    pushAndCreatePr: () => void
    checkout: () => void
    history: () => void
  }
}

export function buildMobileSourceControlActions(
  args: MobileSourceControlActionArgs,
  t: Translate = translate
): MobileSourceControlAction[] {
  const { handlers } = args
  const ctx = deriveDropdownActionContext({
    ...args.decision,
    conflictOperation: args.conflictOperation,
    rebaseBaseRef: args.rebaseBaseRef
  })
  const { commit, commitPush, commitSync } = buildCommitDropdownItems(
    ctx,
    mobileCommitDropdownCopy(t)
  )
  const { push, forcePush, pull, fastForward, sync, rebase, fetch, publish } =
    buildRemoteDropdownItems(ctx, mobileRemoteDropdownCopy(t))
  const busy =
    args.busyAction !== null || args.openingPath !== null || args.openingBranchPath !== null
  const blockForce = (item: DropdownItem): DropdownItem =>
    args.forcePushBlockedReason
      ? { ...item, disabled: true, title: args.forcePushBlockedReason }
      : item
  const row = (
    item: DropdownItem,
    iconKey: MobileSourceControlActionIcon,
    actionId: string,
    onPress: () => void
  ): MobileSourceControlAction => ({
    id: actionId,
    label: item.label,
    iconKey,
    disabled: busy || item.disabled,
    // Mobile has no tooltips: show why a row is disabled, and always what Force Push replaces.
    hint: item.disabled || item.kind === 'force_push' ? item.title : undefined,
    loading: args.busyAction === actionId,
    skipAutoClose: true,
    onPress
  })

  return [
    row(commit, 'commit', 'commit', handlers.commit),
    row(
      ctx.shouldForcePushWithLease ? blockForce(commitPush) : commitPush,
      'push',
      'commit-push',
      () => handlers.commitPush(ctx.shouldForcePushWithLease)
    ),
    row(commitSync, 'sync', 'commit-sync', handlers.commitSync),
    row(push, 'push', 'push', handlers.push),
    row(blockForce(forcePush), 'push', 'force-push', handlers.forcePush),
    {
      id: 'create-pr',
      label: t('sourceControl.actions.createPr', 'Create PR'),
      iconKey: 'pr',
      disabled: busy || !args.prAvailable,
      hint: args.prHint,
      loading: args.busyAction === 'create-pr',
      skipAutoClose: true,
      onPress: handlers.createPr
    },
    {
      id: 'push-create-pr',
      label: t('sourceControl.actions.pushAndCreatePr', 'Push & Create PR'),
      iconKey: 'pr',
      disabled: busy || push.disabled || !args.prAvailable,
      hint: args.prHint ?? (push.disabled ? push.title : undefined),
      loading: args.busyAction === 'push-create-pr',
      skipAutoClose: true,
      onPress: handlers.pushAndCreatePr
    },
    row(pull, 'pull', 'pull', handlers.pull),
    row(fastForward, 'pull', 'fast-forward', handlers.fastForward),
    row(sync, 'sync', 'sync', handlers.sync),
    row(rebase, 'branch', 'rebase', handlers.rebase),
    row(fetch, 'fetch', 'fetch', handlers.fetch),
    row(publish, 'publish', 'publish', handlers.publish),
    {
      id: 'checkout',
      label: t('sourceControl.actions.switchBranch', 'Switch branch'),
      iconKey: 'branch',
      disabled: busy,
      skipAutoClose: true,
      onPress: handlers.checkout
    },
    {
      id: 'history',
      label: t('sourceControl.actions.commits', 'Commits'),
      iconKey: 'history',
      disabled: busy,
      onPress: handlers.history
    }
  ]
}
