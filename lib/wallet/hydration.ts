"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getHydratedSnapshot = () => true;
const getServerSnapshot = () => false;

export function useHydrated() {
  return useSyncExternalStore(subscribe, getHydratedSnapshot, getServerSnapshot);
}
