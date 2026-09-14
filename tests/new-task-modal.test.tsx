import { stubVibe, spy } from './helpers/dom'   // must come first — installs the DOM
import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NewTaskModal from '../src/components/NewTaskModal'
import { usePrefs } from '../src/stores/prefs'

function setSubmitOnEnter(value: boolean) {
  usePrefs.setState({ submitOnEnter: value })
}

test('closed modal renders nothing', () => {
  const restore = stubVibe({})
  try {
    const { container } = render(<NewTaskModal open={false} onClose={() => {}} hasWorkspace />)
    assert.equal(container.innerHTML, '')
  } finally { cleanup(); restore() }
})

test('creating a task trims the fields and reports back', async () => {
  const create = spy({ id: 'task-1' })
  const restore = stubVibe({ tasks: { create } })
  try {
    setSubmitOnEnter(true)
    const user = userEvent.setup()
    let closed = false, created = false
    render(
      <NewTaskModal
        open
        hasWorkspace
        onClose={() => { closed = true }}
        onCreated={() => { created = true }}
      />
    )
    await user.type(screen.getByPlaceholderText(/Task title/), '  Ship the thing  ')
    await user.type(screen.getByPlaceholderText(/Describe the task/), '  do it well  ')
    await user.click(screen.getByRole('button', { name: 'Create task' }))
    await waitFor(() => assert.deepEqual(create.calls, [['Ship the thing', 'do it well']]))
    assert.equal(created, true)
    assert.equal(closed, true)
  } finally { cleanup(); restore() }
})

test('an empty description is sent as undefined, not an empty string', async () => {
  const create = spy({ id: 'task-1' })
  const restore = stubVibe({ tasks: { create } })
  try {
    const user = userEvent.setup()
    render(<NewTaskModal open hasWorkspace onClose={() => {}} />)
    await user.type(screen.getByPlaceholderText(/Task title/), 'Title only')
    await user.click(screen.getByRole('button', { name: 'Create task' }))
    await waitFor(() => assert.deepEqual(create.calls, [['Title only', undefined]]))
  } finally { cleanup(); restore() }
})

test('a create failure is shown in the modal and the modal stays open', async () => {
  const restore = stubVibe({
    tasks: { create: async () => { throw new Error('disk on fire') } }
  })
  try {
    const user = userEvent.setup()
    let closed = false
    render(<NewTaskModal open hasWorkspace onClose={() => { closed = true }} />)
    await user.type(screen.getByPlaceholderText(/Task title/), 'Title')
    await user.click(screen.getByRole('button', { name: 'Create task' }))
    await waitFor(() => assert.ok(screen.getByText('disk on fire')))
    assert.equal(closed, false)
    assert.equal((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled, false)
  } finally { cleanup(); restore() }
})

test('with no workspace the modal explains itself and refuses to create', async () => {
  const create = spy({ id: 'task-1' })
  const restore = stubVibe({ tasks: { create } })
  try {
    const user = userEvent.setup()
    render(<NewTaskModal open hasWorkspace={false} onClose={() => {}} />)
    assert.ok(screen.getByText(/Open a project first/))

    await user.type(screen.getByPlaceholderText(/Task title/), 'Title{Enter}')
    assert.equal((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled, true)
    assert.equal(create.calls.length, 0, 'must not reach the bridge without a workspace')
  } finally { cleanup(); restore() }
})

test('Enter in the title field follows the submitOnEnter preference', async () => {
  const create = spy({ id: 'task-1' })
  const restore = stubVibe({ tasks: { create } })
  try {
    setSubmitOnEnter(true)
    const user = userEvent.setup()
    render(<NewTaskModal open hasWorkspace onClose={() => {}} />)
    await user.type(screen.getByPlaceholderText(/Task title/), 'Enter sends{Enter}')
    await waitFor(() => assert.deepEqual(create.calls, [['Enter sends', undefined]]))
  } finally { cleanup(); restore(); setSubmitOnEnter(true) }
})

test('with submitOnEnter off, plain Enter in the title does nothing and Ctrl+Enter sends', async () => {
  const create = spy({ id: 'task-1' })
  const restore = stubVibe({ tasks: { create } })
  try {
    setSubmitOnEnter(false)
    const user = userEvent.setup()
    render(<NewTaskModal open hasWorkspace onClose={() => {}} />)
    const title = screen.getByPlaceholderText(/Task title/)
    await user.type(title, 'Ctrl sends{Enter}')
    assert.equal(create.calls.length, 0, 'plain Enter must not submit when the pref is off')

    await user.type(title, '{Control>}{Enter}{/Control}')
    await waitFor(() => assert.deepEqual(create.calls, [['Ctrl sends', undefined]]))
  } finally { cleanup(); restore(); setSubmitOnEnter(true) }
})

test('Escape closes the modal', async () => {
  const restore = stubVibe({})
  try {
    const user = userEvent.setup()
    let closed = false
    render(<NewTaskModal open hasWorkspace onClose={() => { closed = true }} />)
    await user.keyboard('{Escape}')
    assert.equal(closed, true)
  } finally { cleanup(); restore() }
})

test('the title field is focused as soon as the modal opens', () => {
  const restore = stubVibe({})
  try {
    const { rerender } = render(<NewTaskModal open={false} hasWorkspace onClose={() => {}} />)
    rerender(<NewTaskModal open hasWorkspace onClose={() => {}} />)
    assert.equal(document.activeElement, screen.getByPlaceholderText(/Task title/))
  } finally { cleanup(); restore() }
})

test('reopening the modal clears what was typed last time', async () => {
  const restore = stubVibe({})
  try {
    const user = userEvent.setup()
    const { rerender } = render(<NewTaskModal open hasWorkspace onClose={() => {}} />)
    await user.type(screen.getByPlaceholderText(/Task title/), 'abandoned draft')

    rerender(<NewTaskModal open={false} hasWorkspace onClose={() => {}} />)
    rerender(<NewTaskModal open hasWorkspace onClose={() => {}} />)

    assert.equal((screen.getByPlaceholderText(/Task title/) as HTMLInputElement).value, '')
  } finally { cleanup(); restore() }
})
