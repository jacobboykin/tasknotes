export const TYPED_RELATIONSHIP_TYPES = ["project", "area", "goal", "related"] as const;

export type TypedRelationshipType = (typeof TYPED_RELATIONSHIP_TYPES)[number];

export interface TypedRelationshipSnapshot {
	path: string;
	outgoing: Record<TypedRelationshipType, string[]>;
	incoming: Record<TypedRelationshipType, string[]>;
	effectiveAreas: string[];
	effectiveGoals: string[];
}
