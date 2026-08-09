import { apiList, apiPost } from "./client";
import type { Project, SourceKind } from "./types";

export type NewProject = {
  name: string;
  source: { kind: SourceKind; url?: string; path?: string };
};

export const listProjects = () => apiList<Project>("/projects");
export const createProject = (project: NewProject) => apiPost<Project>("/projects", project);
