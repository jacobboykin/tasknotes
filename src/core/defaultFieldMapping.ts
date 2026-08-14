import { DEFAULT_FIELD_MAPPING as MODEL_DEFAULT_FIELD_MAPPING } from "@tasknotes/model/mapping";
import type { FieldMapping } from "../types";

export const DEFAULT_FIELD_MAPPING: FieldMapping = {
	...MODEL_DEFAULT_FIELD_MAPPING,
	planningState: "planning",
	areas: "areas",
	goals: "goals",
	relations: "relations",
	projectSection: "projectSection",
	reviewDate: "review",
	recurrenceStartOffset: "recurrence_start_offset",
};
