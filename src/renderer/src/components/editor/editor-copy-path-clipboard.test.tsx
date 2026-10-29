// @vitest-environment happy-dom

import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import {
  makeFolderWorkspace,
  makeWorktree,
  TEST_REPO
} from '@/store/slices/worktrees-slice-test-fixtures'
import { resetRendererAppPlatformCacheForTests } from '@/lib/renderer-app-platform'
import { EditorFileTabContextMenu } from '../tab-bar/EditorFileTabContextMenu'
import { EditorPanelHeaderPath } from './EditorPanelHeaderPath'
import EditorPanel from './EditorPanel'
import type { EditorPanelShell } from './EditorPanelShell'

vi.mock('./useEditorPanelContentState', () => ({
  useEditorPanelContentState: () => ({
    fileContents: {},
    diffContents: {},
    reloadContent: () => {}
  })
}))
vi.mock('./EditorPanelShell', () => ({
  EditorPanelShell: ({
    panelRef,
    activeFile,
    copiedPathVisible,
    onCopyPath
  }: ComponentProps<typeof EditorPanelShell>) => (
    <div ref={panelRef}>
      <EditorPanelHeaderPath
        activeFile={activeFile}
        copiedPathVisible={copiedPathVisible}
        canShowMarkdownPreview={false}
        onCopyPath={onCopyPath}
        onOpenMarkdownPreview={() => {}}
      />
    </div>
  )
}))
vi.mock('../tab-bar/TabWorkspaceLayoutMenuSection', () => ({
  TabWorkspaceLayoutMenuSection: () => null
}))
vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutLabel: () => '',
  useOptionalShortcutLabel: () => null
}))

const initialState = useAppStore.getInitialState()
const writeClipboardText = vi.fn().mockResolvedValue(undefined)
const worktreeId = 'repo1::C:/repo'
let platform: NodeJS.Platform = 'win32'

function file(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id: 'file',
    filePath: 'C:/repo/folder/attachment.txt',
    relativePath: 'folder/attachment.txt',
    worktreeId,
    language: 'plaintext',
    mode: 'edit',
    isDirty: false,
    ...overrides
  }
}

function renderCopyAction(surface: 'tab menu' | 'header menu', activeFile: OpenFile): void {
  useAppStore.setState({ openFiles: [activeFile], activeFileId: activeFile.id })
  if (surface === 'header menu') {
    render(<EditorPanel />)
    const pathButton = screen.getByTitle(activeFile.filePath)
    fireEvent.contextMenu(pathButton)
    return
  }
  render(
    <EditorFileTabContextMenu
      open
      menuPoint={{ x: 0, y: 0 }}
      file={activeFile}
      unifiedTabId="tab"
      groupId="group"
      isPinned={false}
      isRenaming={false}
      hasTabsToRight={false}
      hasTabsToLeft={false}
      tabCount={1}
      canRename
      canShowMarkdownPreview={false}
      resolvedLanguage="plaintext"
      repoConnectionId={null}
      skipMenuFocusRestoreRef={{ current: false }}
      onOpenChange={() => {}}
      onActivate={() => {}}
      onOpenRenameInput={() => {}}
      onTogglePin={() => {}}
      onClose={() => {}}
      onCloseOthers={() => {}}
      onCloseAll={() => {}}
      onCloseToRight={() => {}}
      onCloseToLeft={() => {}}
      onOpenMarkdownPreview={() => {}}
    />
  )
}

beforeEach(() => {
  platform = 'win32'
  resetRendererAppPlatformCacheForTests()
  writeClipboardText.mockClear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ...window.api,
      ui: { ...window.api?.ui, writeClipboardText },
      platform: { get: () => ({ platform }) }
    }
  })
  useAppStore.setState(initialState, true)
  useAppStore.setState({
    repos: [{ ...TEST_REPO, path: 'C:/repo', connectionId: null }],
    worktreesByRepo: {
      [TEST_REPO.id]: [
        makeWorktree({ id: worktreeId, repoId: TEST_REPO.id, path: 'C:/repo', hostId: 'local' })
      ]
    }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
  Reflect.deleteProperty(window, '__ORCA_WEB_CLIENT__')
  resetRendererAppPlatformCacheForTests()
})

describe.each(['tab menu', 'header menu'] as const)(
  'editor %s Copy Path clipboard output',
  (surface) => {
    async function copy(activeFile: OpenFile, expected: string): Promise<void> {
      renderCopyAction(surface, activeFile)
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Path' }))
      await waitFor(() => expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith(expected))
    }

    it.each([
      ['C:/repo/a space/é.txt', 'C:\\repo\\a space\\é.txt'],
      ['//server/share/folder/attachment.txt', '\\\\server\\share\\folder\\attachment.txt'],
      ['D:\\repo/mixed\\attachment.txt', 'D:\\repo\\mixed\\attachment.txt']
    ])('copies local Windows absolute path %s with native separators', async (path, expected) => {
      await copy(file({ filePath: path }), expected)
    })

    it.each(['darwin', 'linux'] as const)(
      'preserves the stored path on %s',
      async (clientPlatform) => {
        platform = clientPlatform
        await copy(file(), 'C:/repo/folder/attachment.txt')
      }
    )

    it.each([
      'https://example.com/folder/attachment.txt',
      'http://example.com/C:/attachment.txt',
      'orca://document/attachment.txt',
      'src/folder/attachment.txt',
      'C:folder/attachment.txt',
      '/repo/folder/attachment.txt'
    ])('preserves non-Windows path %s', async (path) => {
      await copy(file({ filePath: path }), path)
    })

    it.each([{ externalSshTargetId: 'ssh-1' }, { runtimeEnvironmentId: 'paired-server' }])(
      'preserves an explicitly remote file: %j',
      async (route) => {
        await copy(file(route), 'C:/repo/folder/attachment.txt')
      }
    )

    it('preserves an unstamped file owned by a runtime catalog row', async () => {
      useAppStore.setState({
        worktreesByRepo: {
          [TEST_REPO.id]: [
            makeWorktree({ id: worktreeId, repoId: TEST_REPO.id, hostId: 'runtime:paired-server' })
          ]
        }
      })
      await copy(file(), 'C:/repo/folder/attachment.txt')
    })

    it('preserves a path while workspace ownership is unresolved', async () => {
      useAppStore.setState({ repos: [], worktreesByRepo: {} })
      await copy(file(), 'C:/repo/folder/attachment.txt')
    })

    it('copies a local folder workspace path without requiring a git worktree', async () => {
      useAppStore.setState({
        repos: [],
        worktreesByRepo: {},
        folderWorkspaces: [
          makeFolderWorkspace({ id: 'folder', folderPath: 'C:/repo', executionHostId: 'local' })
        ]
      })
      await copy(file({ worktreeId: 'folder:folder' }), 'C:\\repo\\folder\\attachment.txt')
    })

    it('preserves a paired web client path even with legacy local catalog ownership', async () => {
      Object.defineProperty(window, '__ORCA_WEB_CLIENT__', { configurable: true, value: true })
      await copy(file(), 'C:/repo/folder/attachment.txt')
    })

    it('keeps Copy Relative Path unchanged', async () => {
      renderCopyAction(surface, file())
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Relative Path' }))
      await waitFor(() =>
        expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith('folder/attachment.txt')
      )
    })
  }
)

it('copies from the header path button through the same native clipboard action', async () => {
  const activeFile = file()
  useAppStore.setState({ openFiles: [activeFile], activeFileId: activeFile.id })
  render(<EditorPanel />)
  fireEvent.click(screen.getByTitle(activeFile.filePath))
  await waitFor(() =>
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith('C:\\repo\\folder\\attachment.txt')
  )
})
