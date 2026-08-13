import { AbstractInputSuggest, App, setIcon } from "obsidian";
import { splitListPreservingLinksAndQuotes } from "../utils/stringSplit";

export function parseChipValues(value: string): string[] {
	return uniqueChipValues(splitListPreservingLinksAndQuotes(value));
}

export function uniqueChipValues(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const candidate of values) {
		const value = candidate.trim();
		const key = value.toLocaleLowerCase();
		if (!value || seen.has(key)) continue;
		seen.add(key);
		result.push(value);
	}
	return result;
}

interface ChipSuggestion {
	value: string;
	toString(): string;
}

export interface TaskModalChipInputOptions {
	app: App;
	container: HTMLElement;
	value: string;
	placeholder: string;
	ariaLabel: string;
	getSuggestions: () => readonly string[];
	getDisplayValue?: (value: string) => string;
	normalizeValue?: (value: string) => string;
	onChange: (value: string) => void;
}

export class TaskModalChipInput extends AbstractInputSuggest<ChipSuggestion> {
	private readonly chipsEl: HTMLElement;
	private readonly inputEl: HTMLInputElement;
	private values: string[];

	constructor(private readonly options: TaskModalChipInputOptions) {
		const root = options.container.createDiv({ cls: "tn-chip-input" });
		const chipsEl = root.createDiv({ cls: "tn-chip-input__chips" });
		const inputEl = root.createEl("input", {
			cls: "tn-chip-input__input",
			attr: {
				type: "text",
				placeholder: options.placeholder,
				"aria-label": options.ariaLabel,
			},
		});
		super(options.app, inputEl);
		this.chipsEl = chipsEl;
		this.inputEl = inputEl;
		this.values = parseChipValues(options.value);
		this.renderChips();

		inputEl.addEventListener("focus", () => this.open());
		inputEl.addEventListener("click", () => this.open());
		inputEl.addEventListener("keydown", (event) => this.handleKeyDown(event));
		inputEl.addEventListener("blur", () => {
			window.setTimeout(() => this.commitInput(), 0);
		});
	}

	getInputElement(): HTMLInputElement {
		return this.inputEl;
	}

	protected async getSuggestions(query: string): Promise<ChipSuggestion[]> {
		const normalizedQuery = query.trim().toLocaleLowerCase();
		const selected = new Set(this.values.map((value) => value.toLocaleLowerCase()));
		return uniqueChipValues(this.options.getSuggestions())
			.filter((value) => !selected.has(value.toLocaleLowerCase()))
			.filter((value) => {
				const searchable = `${value} ${this.getDisplayValue(value)}`.toLocaleLowerCase();
				return !normalizedQuery || searchable.includes(normalizedQuery);
			})
			.slice(0, 20)
			.map((value) => ({
				value,
				toString() {
					return value;
				},
			}));
	}

	renderSuggestion(suggestion: ChipSuggestion, el: HTMLElement): void {
		el.createSpan({ text: this.getDisplayValue(suggestion.value) });
	}

	selectSuggestion(suggestion: ChipSuggestion): void {
		this.addValue(suggestion.value);
	}

	private handleKeyDown(event: KeyboardEvent): void {
		if (event.defaultPrevented) return;
		if (event.key === "Backspace" && !this.inputEl.value && this.values.length > 0) {
			this.values.pop();
			this.emitChange();
			return;
		}
		if (event.key === "," || event.key === "Enter") {
			event.preventDefault();
			this.commitInput();
		}
	}

	private commitInput(): void {
		this.addValue(this.inputEl.value);
	}

	private addValue(rawValue: string): void {
		const normalized = this.options.normalizeValue?.(rawValue) ?? rawValue.trim();
		const nextValues = uniqueChipValues([...this.values, normalized]);
		this.inputEl.value = "";
		if (nextValues.length === this.values.length) return;
		this.values = nextValues;
		this.emitChange();
		this.inputEl.focus();
		this.open();
	}

	private removeValue(value: string): void {
		this.values = this.values.filter((candidate) => candidate !== value);
		this.emitChange();
	}

	private emitChange(): void {
		this.renderChips();
		this.options.onChange(this.values.join(", "));
	}

	private renderChips(): void {
		this.chipsEl.empty();
		for (const value of this.values) {
			const chip = this.chipsEl.createSpan({ cls: "tn-chip-input__chip" });
			chip.createSpan({ cls: "tn-chip-input__label", text: this.getDisplayValue(value) });
			const remove = chip.createEl("button", {
				cls: "tn-chip-input__remove",
				attr: { type: "button", "aria-label": `Remove ${value}` },
			});
			setIcon(remove, "x");
			remove.addEventListener("click", () => this.removeValue(value));
		}
	}

	private getDisplayValue(value: string): string {
		return this.options.getDisplayValue?.(value) || value;
	}
}
