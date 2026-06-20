/**
 * Typed Redux hooks.
 *
 * Always import `useAppDispatch` and `useAppSelector` from here instead of
 * `react-redux` directly so TypeScript can infer the full RootState shape.
 */

import { useDispatch, useSelector } from "react-redux";
import type { RootState, AppDispatch } from "./store";

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector = <T>(selector: (state: RootState) => T): T => useSelector(selector);
