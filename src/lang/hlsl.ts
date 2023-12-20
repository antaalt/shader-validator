
export class Parameter {
    description?: string;
}

export interface Parameters { [name: string]: Parameter;}

// TODO could have some parser on doc.
export let intrinsics: Parameters = {
    "smoothstep": {
        "description": "hello there",
    }
};