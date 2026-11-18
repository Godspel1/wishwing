import type { Animal } from "../flock";
import { butterflies } from "./butterflies";
import { fireflies } from "./fireflies";

/** Every animal, in the order the choices show them. */
export const ANIMALS = {
  butterflies,
  fireflies,
} satisfies Record<string, Animal<any>>;

export type AnimalKey = keyof typeof ANIMALS;

export const ANIMAL_KEYS = Object.keys(ANIMALS) as AnimalKey[];
