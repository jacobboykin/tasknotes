# TaskNotes - Unreleased

<!--

**Added** for new features.
**Changed** for changes in existing functionality.
**Deprecated** for soon-to-be removed features.
**Removed** for now removed features.
**Fixed** for any bug fixes.
**Security** in case of vulnerabilities.

Always acknowledge contributors and those who report issues.

Example:

```
## Fixed

- (#768) Fixed calendar view appearing empty in week and day views due to invalid time configuration values
  - Added time validation in settings UI with proper error messages and debouncing
  - Prevents "Cannot read properties of null (reading 'years')" error from FullCalendar
  - Thanks to @userhandle for reporting and help debugging
```

When a change has user-facing documentation, include a canonical tasknotes.dev link:

```
## Added

- Added materialized occurrence notes for recurring tasks. See [Recurring Tasks](https://tasknotes.dev/features/recurring-tasks/#materialized-occurrence-notes) for setup and calendar behavior.
```

-->

## Added

- Added Things-style planning with native Inbox, Today, Upcoming, Anytime, Someday, and Logbook views. See [Workflows](https://tasknotes.dev/workflows/) for daily and weekly planning.
- Added searchable multi-select chips for tags, contexts, areas, goals, and related notes.
- Added first-class project, area, and goal notes, project sections, review dates, reverse relationships, and a combined organization/review Base.
- Added Quick Find plus dedicated Inbox capture, Today capture, planning, and entity-creation commands.
- Added Things-style recurring task templates with independent copies created on schedule, optional repeat-after-completion behavior, and start-before-deadline offsets. See [Recurring Tasks](https://tasknotes.dev/features/recurring-tasks/#occurrence-note-policies) for setup and behavior.

## Changed

- Project suggestions now prioritize first-class project notes, and task planning actions are available from both single-task and batch menus.
