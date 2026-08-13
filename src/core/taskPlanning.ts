import type { PlanningState, TaskInfo } from "../types";

export const PLANNING_STATES = ["inbox", "anytime", "someday"] as const;

export type PlanningList = PlanningState | "today" | "upcoming" | "logbook";

export function normalizePlanningState(value: unknown): PlanningState {
	return typeof value === "string" && PLANNING_STATES.includes(value as PlanningState)
		? (value as PlanningState)
		: "anytime";
}

export function getPlanningList(
	task: Pick<TaskInfo, "planningState" | "scheduled" | "due" | "archived" | "status">,
	today: string,
	isCompletedStatus: (status: string) => boolean
): PlanningList {
	if (task.archived || isCompletedStatus(task.status)) return "logbook";

	const state = normalizePlanningState(task.planningState);
	if (state === "inbox" || state === "someday") return state;

	const days = [task.scheduled, task.due].flatMap((value) =>
		value ? [value.slice(0, 10)] : []
	);
	if (days.length === 0) return "anytime";
	return days.some((day) => day <= today) ? "today" : "upcoming";
}

export function getPlanningStateUpdate(
	state: PlanningState
): Pick<TaskInfo, "planningState" | "scheduled"> {
	return { planningState: state, scheduled: undefined };
}

export function getScheduledPlanningUpdate(
	scheduled: string | undefined
): Pick<TaskInfo, "planningState" | "scheduled"> {
	return { planningState: "anytime", scheduled };
}
