import { Bold, Italic, Underline, List, ListOrdered, Heading1, Heading2, Link2, RemoveFormatting } from 'lucide-react'

/**
 * Floating toolbar that operates on whichever contenteditable currently
 * has focus. Lives in the editor's sticky header so users don't lose it
 * when scrolling a long resume.
 *
 * We deliberately use `document.execCommand` — yes, it's "deprecated",
 * but the API is the only one-line cross-browser way to bold/italic
 * inside contenteditable, and no modern replacement has shipped. The
 * Editor.js / TipTap / Lexical alternatives bring in 50–100kb of deps
 * to do the same thing.
 *
 * Buttons swallow mousedown so the toolbar click doesn't blur the
 * focused editor before the command fires.
 */
export default function RichTextToolbar() {
  const exec = (cmd, arg = null) => {
    // If the user clicked away to the toolbar itself, the active element
    // may not be the contenteditable. We restore focus to whatever was
    // last edited by relying on the browser's selection — execCommand
    // operates on the current selection, so as long as we didn't blur,
    // it works.
    document.execCommand(cmd, false, arg)
  }

  const onLink = () => {
    const url = window.prompt('Link URL')
    if (!url) return
    exec('createLink', url)
  }

  const Btn = ({ title, onClick, children }) => (
    <button
      type="button"
      className="rt-toolbar-btn"
      title={title}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )

  return (
    <div className="rt-toolbar" onMouseDown={e => e.preventDefault()}>
      <Btn title="Heading 1"  onClick={() => exec('formatBlock', 'H1')}><Heading1 size={14} /></Btn>
      <Btn title="Heading 2"  onClick={() => exec('formatBlock', 'H2')}><Heading2 size={14} /></Btn>
      <span className="rt-toolbar-sep" />
      <Btn title="Bold (⌘B)"    onClick={() => exec('bold')}><Bold size={13} /></Btn>
      <Btn title="Italic (⌘I)"  onClick={() => exec('italic')}><Italic size={13} /></Btn>
      <Btn title="Underline (⌘U)" onClick={() => exec('underline')}><Underline size={13} /></Btn>
      <span className="rt-toolbar-sep" />
      <Btn title="Bulleted list"  onClick={() => exec('insertUnorderedList')}><List size={13} /></Btn>
      <Btn title="Numbered list"  onClick={() => exec('insertOrderedList')}><ListOrdered size={13} /></Btn>
      <span className="rt-toolbar-sep" />
      <Btn title="Link"          onClick={onLink}><Link2 size={13} /></Btn>
      <Btn title="Clear formatting" onClick={() => exec('removeFormat')}><RemoveFormatting size={13} /></Btn>
    </div>
  )
}
