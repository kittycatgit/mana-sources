import {
  PublicationStatus,
  SearchMultiPicker,
  type Option,
  type SearchListField,
  type SortOption,
} from "@mana-app/types";

export const BASE_URL = "https://tailspace.com";
export const IMAGE_BASE_URL = "https://pics.tailspace.com";

export const HOME_ROUTE = "routes/pages/home";
export const BROWSE_ROUTE = "routes/pages/browse/BrowsePage";
export const COMIC_ROUTE = "routes/pages/comic/ComicPage";

export const FilterID = {
  Category: "category",
  Tags: "tags",
} as const;

export const SortID = {
  Updated: "updated",
  Popularity: "popularity",
  Quality: "quality",
  Random: "random",
} as const;

export const ListID = {
  Featured: "featured",
  Updated: "updated",
  Popular: "popular",
} as const;

export const CATEGORY_OPTIONS: Option[] = [
  { id: "Male", title: "Male" },
  { id: "Female", title: "Female" },
  { id: "Intersex", title: "Intersex" },
  { id: "Mix", title: "Mix" },
];

export const SEARCH_FIELDS: SearchListField[] = [
  SearchMultiPicker({
    id: FilterID.Category,
    title: "Category",
    subtitle: "Leave empty for every category",
    options: CATEGORY_OPTIONS,
  }),
];

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Updated, title: "Recently Updated", isDefault: true, isOrderable: false },
  { id: SortID.Popularity, title: "Score (popularity)", isOrderable: false },
  { id: SortID.Quality, title: "Average score (quality)", isOrderable: false },
  { id: SortID.Random, title: "Random", isOrderable: false },
];

// The site derives each slug with `title.toLowerCase().replace(" ", "-")`, and a string
// first argument to String.replace swaps only the FIRST space — so the quality slug really
// does keep a literal space, and "Updated" is sent by omitting the parameter entirely.
export const SORT_QUERY: Record<string, string> = {
  [SortID.Updated]: "",
  [SortID.Popularity]: "score-(popularity)",
  [SortID.Quality]: "average-score (quality)",
  [SortID.Random]: "random",
};

export const STATUS_BY_STATE: Record<string, PublicationStatus> = {
  wip: PublicationStatus.ONGOING,
  finished: PublicationStatus.COMPLETED,
  cancelled: PublicationStatus.CANCELLED,
};

export type BrowseQuery = {
  page: number;
  search?: string;
  sort?: string;
  categories?: readonly string[];
  tags?: readonly string[];
  excludeTags?: readonly string[];
};
