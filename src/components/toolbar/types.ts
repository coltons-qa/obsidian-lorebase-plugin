import { FilterState, LibraryViewState, MediaType, SortField, SortOrder, ViewMode } from '../../types';

export interface ToolbarCallbacks {
    onSortChange: (field: SortField, order: SortOrder) => void;
    onFilterChange: (filter: Partial<FilterState>) => void;
    onSearch: (term: string) => void;
    onAdd: () => void;
    onRandom: () => void;
    onStats: () => void;
    onSettings: () => void;
    onViewModeChange: (mode: ViewMode) => void;
    onViewStateChange: (state: LibraryViewState) => void;
    onApplySavedView: (id: string | null) => void;
    onSaveView: (name: string, state: LibraryViewState) => void;
    onUpdateSavedView: (id: string, state: LibraryViewState) => void;
    onRenameSavedView: (id: string, name: string) => void;
    onDeleteSavedView: (id: string) => void;
    onResetView: () => void;
    onMediaTypeChange: (mediaType: MediaType) => void;
    onCheckNewSeasons?: () => void;
}

export type TagSummary = {
    id: string;
    label: string;
    count: number;
};

export type TagGroups = {
    planTags?: TagSummary[];
    tags: TagSummary[];
    genres: TagSummary[];
};
