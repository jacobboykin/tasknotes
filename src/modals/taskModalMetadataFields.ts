import { App, Setting } from "obsidian";
import TaskNotesPlugin from "../main";
import type { PlanningState } from "../types";
import { calculateDefaultDate, sanitizeTags } from "../utils/helpers";
import { filterTagsForTaskModalSuggestions } from "../utils/taskTagFiltering";
import { TaskModalChipInput } from "./taskModalChipInput";
import { generateLink, getProjectDisplayName } from "../utils/linkUtils";

export interface TaskModalMetadataFieldContext {
	app: App;
	plugin: TaskNotesPlugin;
	translate: (key: string, params?: Record<string, string | number>) => string;
	attachMobileKeyboardScrollGuard: (input: HTMLInputElement) => void;
}

export interface CreateTaskModalTextFieldOptions {
	container: HTMLElement;
	value: string;
	onChange: (value: string) => void;
}

export interface CreateTaskModalTimeEstimateFieldOptions {
	container: HTMLElement;
	value: number;
	onChange: (value: number) => void;
}

export interface CreateTaskModalSuggestionFieldOptions
	extends CreateTaskModalTextFieldOptions {
	label: string;
	placeholder: string;
	getSuggestions: () => readonly string[];
}

export interface CreateTaskModalPlanningFieldOptions {
	container: HTMLElement;
	planningState: PlanningState;
	scheduledDate: string;
	onChange: (planningState: PlanningState, scheduledDate: string) => void;
}

export function createTaskModalPlanningField(
	context: TaskModalMetadataFieldContext,
	options: CreateTaskModalPlanningFieldOptions
): HTMLSelectElement {
	let selectEl: HTMLSelectElement | null = null;
	const selectedValue = options.scheduledDate
		? options.scheduledDate.slice(0, 10) <= calculateDefaultDate("today")
			? "today"
			: "scheduled"
		: options.planningState;

	new Setting(options.container)
		.setName(context.translate("modals.task.planning.label"))
		.setDesc(context.translate("modals.task.planning.description"))
		.addDropdown((dropdown) => {
			dropdown
				.addOption("inbox", context.translate("modals.task.planning.inbox"))
				.addOption("anytime", context.translate("modals.task.planning.anytime"))
				.addOption("today", context.translate("modals.task.planning.today"));
			if (selectedValue === "scheduled") {
				dropdown.addOption(
					"scheduled",
					context.translate("modals.task.planning.scheduled", {
						date: options.scheduledDate.slice(0, 10),
					})
				);
			}
			dropdown
				.addOption("someday", context.translate("modals.task.planning.someday"))
				.setValue(selectedValue)
				.onChange((value) => {
					if (value === "today") {
						options.onChange("anytime", calculateDefaultDate("today"));
					} else if (value !== "scheduled") {
						options.onChange(value as PlanningState, "");
					}
				});
			selectEl = dropdown.selectEl;
		});

	if (!selectEl) throw new Error("Failed to create planning input");
	return selectEl;
}

export function parseTaskModalTimeEstimate(value: string): number {
	return parseInt(value) || 0;
}

export function createTaskModalContextsField(
	context: TaskModalMetadataFieldContext,
	options: CreateTaskModalTextFieldOptions
): HTMLInputElement {
	const setting = new Setting(options.container);
	setting.settingEl.addClass("tn-task-modal__wide-text-setting");
	setting.setName(context.translate("modals.task.contextsLabel"));
	const chips = new TaskModalChipInput({
		app: context.app,
		container: setting.controlEl,
		value: options.value,
		placeholder: context.translate("modals.task.contextsPlaceholder"),
		ariaLabel: context.translate("modals.task.contextsLabel"),
		getSuggestions: () => context.plugin.cacheManager.getAllContexts(),
		onChange: options.onChange,
	});
	const inputEl = chips.getInputElement();
	context.attachMobileKeyboardScrollGuard(inputEl);
	return inputEl;
}

export function createTaskModalTagsField(
	context: TaskModalMetadataFieldContext,
	options: CreateTaskModalTextFieldOptions
): HTMLInputElement {
	const setting = new Setting(options.container);
	setting.settingEl.addClass("tn-task-modal__wide-text-setting");
	setting.setName(context.translate("modals.task.tagsLabel"));
	const chips = new TaskModalChipInput({
		app: context.app,
		container: setting.controlEl,
		value: sanitizeTags(options.value),
		placeholder: context.translate("modals.task.tagsPlaceholder"),
		ariaLabel: context.translate("modals.task.tagsLabel"),
		normalizeValue: (value) => sanitizeTags(value).replace(/,$/, "").trim(),
		getSuggestions: () =>
			filterTagsForTaskModalSuggestions(
				context.plugin.cacheManager.getAllTags(),
				context.plugin.settings
			),
		onChange: (value) => options.onChange(sanitizeTags(value)),
	});
	const inputEl = chips.getInputElement();
	context.attachMobileKeyboardScrollGuard(inputEl);
	return inputEl;
}

export function createTaskModalAreasField(
	context: TaskModalMetadataFieldContext,
	options: CreateTaskModalTextFieldOptions
): HTMLInputElement {
	return createTaskModalLinkField(context, {
		...options,
		label: context.translate("modals.task.areasLabel"),
		placeholder: context.translate("modals.task.areasPlaceholder"),
		getSuggestions: () => getEntityLinkSuggestions(context, "area"),
	});
}

export function createTaskModalGoalsField(
	context: TaskModalMetadataFieldContext,
	options: CreateTaskModalTextFieldOptions
): HTMLInputElement {
	return createTaskModalLinkField(context, {
		...options,
		label: context.translate("modals.task.goalsLabel"),
		placeholder: context.translate("modals.task.goalsPlaceholder"),
		getSuggestions: () => getEntityLinkSuggestions(context, "goal"),
	});
}

export function createTaskModalRelationsField(
	context: TaskModalMetadataFieldContext,
	options: CreateTaskModalTextFieldOptions
): HTMLInputElement {
	return createTaskModalLinkField(context, {
		...options,
		label: context.translate("modals.task.relationsLabel"),
		placeholder: context.translate("modals.task.relationsPlaceholder"),
		getSuggestions: () => getEntityLinkSuggestions(context),
	});
}

function createTaskModalLinkField(
	context: TaskModalMetadataFieldContext,
	options: CreateTaskModalSuggestionFieldOptions
): HTMLInputElement {
	const setting = new Setting(options.container);
	setting.settingEl.addClass("tn-task-modal__wide-text-setting");
	setting.setName(options.label);
	const chips = new TaskModalChipInput({
		app: context.app,
		container: setting.controlEl,
		value: options.value,
		placeholder: options.placeholder,
		ariaLabel: options.label,
		getSuggestions: options.getSuggestions,
		getDisplayValue: (value) => getProjectDisplayName(value, context.app),
		onChange: options.onChange,
	});
	const inputEl = chips.getInputElement();
	context.attachMobileKeyboardScrollGuard(inputEl);
	return inputEl;
}

function getEntityLinkSuggestions(
	context: TaskModalMetadataFieldContext,
	type?: "area" | "goal"
): string[] {
	const sourcePath = context.app.workspace.getActiveFile()?.path || "";
	return context.app.vault
		.getMarkdownFiles()
		.filter((file) => {
			if (!type) return file.path !== sourcePath;
			return context.app.metadataCache.getFileCache(file)?.frontmatter?.tasknotesType === type;
		})
		.map((file) =>
			generateLink(
				context.app,
				file,
				sourcePath,
				undefined,
				undefined,
				context.plugin.settings.useFrontmatterMarkdownLinks
			)
		);
}

export function createTaskModalProjectSectionField(
	context: TaskModalMetadataFieldContext,
	options: CreateTaskModalSuggestionFieldOptions
): HTMLInputElement {
	let inputEl: HTMLInputElement | null = null;
	new Setting(options.container).setName(options.label).addText((text) => {
		text.setPlaceholder(options.placeholder).setValue(options.value).onChange(options.onChange);
		inputEl = text.inputEl;
		const listId = `tn-project-sections-${crypto.randomUUID()}`;
		text.inputEl.setAttribute("list", listId);
		const list = options.container.createEl("datalist", { attr: { id: listId } });
		const refresh = () => {
			list.empty();
			for (const suggestion of options.getSuggestions()) {
				list.createEl("option", { value: suggestion });
			}
		};
		refresh();
		text.inputEl.addEventListener("focus", refresh);
		context.attachMobileKeyboardScrollGuard(text.inputEl);
	});
	if (!inputEl) throw new Error("Failed to create project section input");
	return inputEl;
}

export function createTaskModalReviewDateField(
	context: TaskModalMetadataFieldContext,
	options: CreateTaskModalTextFieldOptions
): HTMLInputElement {
	let inputEl: HTMLInputElement | null = null;
	new Setting(options.container)
		.setName(context.translate("modals.task.reviewDateLabel"))
		.addText((text) => {
			text.inputEl.type = "date";
			text.setValue(options.value).onChange(options.onChange);
			inputEl = text.inputEl;
		});
	if (!inputEl) throw new Error("Failed to create review date input");
	return inputEl;
}

export function createTaskModalTimeEstimateField(
	context: TaskModalMetadataFieldContext,
	options: CreateTaskModalTimeEstimateFieldOptions
): HTMLInputElement {
	let inputEl: HTMLInputElement | null = null;
	new Setting(options.container)
		.setName(context.translate("modals.task.timeEstimateLabel"))
		.addText((text) => {
			text.setPlaceholder(context.translate("modals.task.timeEstimatePlaceholder"))
				.setValue(options.value.toString())
				.onChange((value) => {
					options.onChange(parseTaskModalTimeEstimate(value));
				});

			inputEl = text.inputEl;
			context.attachMobileKeyboardScrollGuard(text.inputEl);
		});

	if (!inputEl) {
		throw new Error("Failed to create time estimate input");
	}
	return inputEl;
}
