# Projects, Areas, Goals, and Relationships

TaskNotes uses explicit frontmatter properties for organization. Obsidian links resolve the referenced files, but an ordinary link or backlink does not create a TaskNotes relationship.

## Intended model

- An **Area** is an ongoing responsibility such as Health, Work, or Finances. It has no completion point.
- A **Goal** is a measurable desired outcome such as Run a marathon.
- A **Project** is a finite, multi-step outcome. A Project can belong to an Area and contribute to one or more Goals.
- A **Task** is a concrete action. It normally belongs to a Project.

Store each relationship once, from the more specific note to its organizing note:

```yaml
# TaskNotes/Projects/Marathon training.md
tasknotesType: project
areas:
    - "[[Health]]"
goals:
    - "[[Run a marathon]]"
```

```yaml
# TaskNotes/Tasks/Run today.md
projects:
    - "[[Marathon training]]"
```

Do not add a matching list of Tasks to the Project or a matching list of Projects to the Area or Goal. TaskNotes indexes the inverse relationships automatically, so there is only one source of truth.

## Effective Areas and Goals

A Task's effective Areas and Goals are its direct `areas` and `goals` plus those assigned to its Projects. In the example above, **Run today** belongs to **Health** and contributes to **Run a marathon** without copying either link into the Task.

Direct Task-to-Area or Task-to-Goal links remain available for standalone actions that do not belong to a Project. The Relationships widget resolves effective membership in either direction.

## Relationships versus mentions

The following properties create typed TaskNotes relationships:

| Property    | Meaning                             |
| ----------- | ----------------------------------- |
| `projects`  | Task belongs to Project             |
| `areas`     | Task or Project belongs to Area     |
| `goals`     | Task or Project contributes to Goal |
| `relations` | Explicit general relationship       |

A link in note content is only a **mention**. It appears in Obsidian's Backlinks view, but it does not affect TaskNotes organization, inheritance, or relationship views.

## Creating and editing entities

Use **Create project**, **Create area**, or **Create goal** from the command palette. Open a Project and run **Edit current project, area or goal** to select Areas, Goals, and related notes from searchable popups. The normal task create and edit modals provide the corresponding Project, Area, Goal, and Related-note selectors for Tasks.

Use **Open projects, areas & goals** to browse active entities and scheduled reviews.

## Are Areas required?

No. Tags and Bases views are sufficient when values such as `work` and `health` are only categories. Use first-class Areas when they represent stable responsibilities that need their own note, Projects, review state, and relationship rollups. Avoid maintaining both an Area and an equivalent tag.
