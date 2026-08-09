import { useContext } from "react";

import { CreateModalContext } from "./CreateModalProvider";
import type { CreateModalValue } from "./CreateModalProvider";

export function useCreateModal(): CreateModalValue {
  const value = useContext(CreateModalContext);
  if (value === null) {
    throw new Error("useCreateModal must be used inside a CreateModalProvider");
  }
  return value;
}
