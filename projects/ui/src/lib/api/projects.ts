import { apiDelete, apiFetch, apiList, apiPost } from "./client";
import type { Project, SourceKind } from "./types";

export type NewProject = {
  name: string;
  source: { kind: SourceKind; url?: string; path?: string };
};

export const listProjects = () => apiList<Project>("/projects");
export const readProject = (id: string) => apiFetch<Project>(`/projects/${id}`);
export const createProject = (project: NewProject) => apiPost<Project>("/projects", project);
export const deleteProject = (id: string) => apiDelete(`/projects/${id}`);
