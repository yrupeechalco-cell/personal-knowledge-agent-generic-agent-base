# User Guide: From a Folder to a Daily Knowledge Workspace

**Documentation language:** [简体中文](USAGE_GUIDE.md) | [English](USAGE_GUIDE_EN.md)

This guide describes the currently available public version and distinguishes desktop capabilities from browser permissions.

## 1. Choose Where Knowledge Is Stored

Open **Storage** from the folder icon in the upper-left corner.

![Storage entry](images/local-storage.png)

The Windows App supports two real local operations:

1. **Open an existing folder:** choose any ordinary folder containing Markdown. It does not need to be an Obsidian vault.
2. **Choose a location and create:** create a new knowledge-base folder on a selected drive and keep future notes there.

The browser can only open folders after explicit permission and cannot create a folder at an arbitrary disk location. Use the Windows App for full daily read and write access.

The Web App can also open public GitHub repositories read only:

1. Enter `owner/repo` or a repository URL under **Public GitHub knowledge base**.
2. Select **Open** to read safe Markdown from the repository's default branch.
3. The file tree, wiki links, graph, tags, reader, and Agent question flow remain available.
4. Create, edit, rename, delete, Agent diff application, and repository write-back remain disabled.

The main product starts with no bundled notes. The official public example is loaded only when selected.

## 2. Browse and Organize Files

The left column follows the actual parent-child folder hierarchy. Folders can be collapsed and the filter can narrow the note list quickly.

For writable local sources, right-click a note or folder to create, rename, copy, cut, paste, or start the delete flow. Opening another note does not discard the current one; top tabs keep multiple documents available like browser tabs.

## 3. Use the Graphs

![Whole-collection tag knowledge map](images/workspace-graph.png)

The center workspace separates the tag system from explicit file relationships:

- **Tag system:** turns document tags into a three-dimensional knowledge cloud. Classification, connection, application, and source domains provide different viewpoints while keeping each tag's base size and each relation's base brightness stable.
- **File relationships:** show traceable `[[wiki links]]`, backlinks, and unresolved concepts.

- Drag empty space to pan.
- Use the mouse wheel to zoom around the pointer.
- Drag a node to adjust its local position.
- Hover a node to dim unrelated nodes and emphasize direct connections.
- Select a tag sphere to enter its two-dimensional root map, then open source notes from the leaves.
- Select a file node to open its note directly.
- Labels fade as their real screen size becomes unreadable and return when zoomed in.
- Hold `Ctrl` and drag with the left mouse button to select multiple file nodes.

Tag relations come from shared tags, explicit links, and traceable source evidence; file relationships come from note content such as `[[wiki links]]`. The App does not invent strong links merely because files share a folder.

## 4. Read, Edit, and Review Local Context

![Note workspace](images/note-and-agent.png)

Opening a note shows its Markdown reader or editor in the center. A miniature relationship graph below the note keeps direct links, backlinks, and unresolved concepts in view.

Local edits are tracked as session changes. The **Changes and Trash** panel shows each path, change type, diff, and safety result before local write-back. Deleted files move into `.knowledge-agent-trash`, retain their original path and timestamps for 30 days, and can be restored after Agent review.

## 5. Use Note Agent

1. Open Agent settings from the icon at the top of the right panel.
2. Select a model and Agent mode. Enter your own API key in the separate connection dialog when using an online model for the first time.
3. Enter a request and press `Enter` or **Send**.
4. The Agent can search and read notes, create drafts, suggest links, generate an MOC, organize content, and open graph views through controlled tools.

The status strip is functional:

- **Model:** the current model or offline state.
- **Effort:** the reasoning setting attached to the current Agent mode.
- **Context percentage:** a live estimate based on the current conversation, note, attached notes, and knowledge-base overview.
- **Folder upload icon:** attach the current note to this Agent session.
- **Plus:** start an independent sub-agent conversation.
- **Refresh:** clear the current conversation while saving a restorable snapshot.
- **History:** restore the latest snapshot together with its messages and context memory.

The App remains interactive while a model request is running.

## 6. Safety Boundary

The App excludes sensitive or tool paths such as `.git`, `.obsidian`, `.claude`, `.venv`, `node_modules`, `.env`, `secret`, `token`, password, and account paths by default.

Your API key is local configuration. It is not stored in the repository, installer, screenshots, Issues, or public documentation. The desktop App never includes another user's key or knowledge base.

Return to the [English product overview](../README_EN.md) for architecture and capability details.
