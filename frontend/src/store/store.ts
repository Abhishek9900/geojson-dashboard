/**
 * Redux store configuration.
 *
 * Combines the two slices:
 *   - `dashboard` — data state (upload, response, featureCollection, …)
 *   - `table`     — UI state (filter, search, sort, pagination)
 *
 * `AppThunk` is the typed thunk type used by all async action creators.
 */

import { configureStore, ThunkAction, Action } from "@reduxjs/toolkit";
import dashboardReducer from "./dashboardSlice";
import tableReducer from "./tableSlice";

export const store = configureStore({
  reducer: {
    dashboard: dashboardReducer,
    table: tableReducer,
  },
  // `FeatureCollection` objects can be large; the default serialisability
  // check would fire for features with complex coordinate arrays.  We disable
  // it for the dashboard slice only.
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredPaths: [
          "dashboard.featureCollection",
          "dashboard.pendingFC",
          "dashboard.response",
        ],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export type AppThunk<ReturnType = void> = ThunkAction<
  ReturnType,
  RootState,
  unknown,
  Action<string>
>;
