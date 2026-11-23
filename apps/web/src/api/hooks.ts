import { useMutation, useMutationState, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { withCableLengths } from '@/lib/buildplan';
import {
  api,
  type ActiveModel,
  type CableLengths,
  type ChatMessage,
  type EndpointInput,
  type LlmStatus,
  type Project,
  type ProjectChange,
  type ProjectInput,
  type ProjectSummary,
} from './client';

export const keys = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  examples: ['examples'] as const,
  llm: ['llm'] as const,
  claudeModels: ['llm', 'claude-models'] as const,
  messages: (projectId: string) => ['messages', projectId] as const,
};

/** Put a changed project into the cache and refresh the list (it is ordered by updatedAt). */
function storeProject(qc: QueryClient, project: Project) {
  qc.setQueryData(keys.project(project.id), project);
  qc.setQueryData<ProjectSummary[]>(keys.projects, (list) =>
    list?.map((p) =>
      p.id === project.id
        ? { ...p, name: project.name, description: project.description, circuitCount: project.circuits.length, updatedAt: project.updatedAt }
        : p,
    ),
  );
  return qc.invalidateQueries({ queryKey: keys.projects });
}

export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: api.listProjects });

export const useExamples = () => useQuery({ queryKey: keys.examples, queryFn: api.listExamples, staleTime: 5 * 60_000 });

export const useProject = (id: string) =>
  useQuery({
    queryKey: keys.project(id),
    queryFn: () => api.getProject(id),
    // A missing project will not appear by retrying.
    retry: (count, err) => !(err as { status?: number }).status && count < 2,
  });

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectInput) => api.createProject(input),
    onSuccess: (project) => storeProject(qc, project),
  });
}

export function useCreateFromExample() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (exampleId: string) => api.createFromExample(exampleId),
    onSuccess: (project) => storeProject(qc, project),
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<ProjectInput>) => api.updateProject(id, patch),
    onSuccess: (project) => storeProject(qc, project),
  });
}

/** Circuit writes return the whole project; it replaces the cached one and updates the sidebar row (count, order by time). */
const storeChange = (qc: QueryClient, change: ProjectChange) => storeProject(qc, change.project);

export function useRenameCircuit(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ circuitId, name }: { circuitId: string; name: string }) => api.updateCircuit(projectId, circuitId, { name }),
    onSuccess: (change) => storeChange(qc, change),
  });
}

/**
 * Saves the lengths and allowance of one circuit. The cached project is updated at once so the lists and totals follow
 * the typing; a failed save puts the previous state back. The server's answer replaces the cache once it arrives.
 */
export function useSaveCableLengths(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['cable-lengths', projectId],
    mutationFn: ({ circuitId, value }: { circuitId: string; value: CableLengths }) => api.saveCableLengths(projectId, circuitId, value),
    onMutate: async ({ circuitId, value }) => {
      await qc.cancelQueries({ queryKey: keys.project(projectId) });
      const previous = qc.getQueryData<Project>(keys.project(projectId));
      if (previous) qc.setQueryData<Project>(keys.project(projectId), withCableLengths(previous, circuitId, value));
      return { previous };
    },
    onError: (_err, { circuitId }, ctx) => {
      // Put back only this circuit's previous value: another save may have changed other state meanwhile.
      const before = ctx?.previous?.circuits.find((c) => c.id === circuitId);
      qc.setQueryData<Project>(keys.project(projectId), (p) => (p && before ? withCableLengths(p, circuitId, before.cableLengths) : p));
    },
    onSuccess: (change) => {
      // With another save still in flight the cache already holds the newer optimistic state; that save's answer settles it.
      if (qc.isMutating({ mutationKey: ['cable-lengths', projectId] }) > 1) return;
      return storeChange(qc, change);
    },
  });
}

export function useDeleteCircuit(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (circuitId: string) => api.deleteCircuit(projectId, circuitId),
    onSuccess: (change) =>
      Promise.all([
        storeChange(qc, change),
        // the server clears the circuit link of the messages that created it
        qc.invalidateQueries({ queryKey: keys.messages(projectId) }),
      ]),
  });
}

export function useReorderCircuits(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.reorderCircuits(projectId, ids),
    onSuccess: (change) => storeChange(qc, change),
  });
}

/** Discarding a plan changes the project only (circuits stay); the project replaces the cached one. */
export function useDiscardPlan(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.discardPlan(projectId),
    onSuccess: (change) => storeChange(qc, change),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<ProjectSummary[]>(keys.projects, (list) => list?.filter((p) => p.id !== id));
      return qc.invalidateQueries({ queryKey: keys.projects });
    },
    // The page for the deleted project is left by the caller; drop its cache entry once it is gone.
    onSettled: (_d, _e, id) => {
      setTimeout(() => qc.removeQueries({ queryKey: keys.project(id), exact: true }), 0);
    },
  });
}

// ---- model settings ----

export const useLlmStatus = () => useQuery({ queryKey: keys.llm, queryFn: api.getLlmStatus });

/** The Claude model list needs a working key; a failure is shown to the user, so it is not retried. */
export const useClaudeModels = (enabled: boolean) =>
  useQuery({ queryKey: keys.claudeModels, queryFn: api.listClaudeModels, enabled, retry: false, staleTime: 5 * 60_000 });

const storeStatus = (qc: QueryClient, status: LlmStatus) => qc.setQueryData(keys.llm, status);

export function useSetAnthropicKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.setAnthropicKey(key),
    onSuccess: (status) => {
      storeStatus(qc, status);
      return qc.invalidateQueries({ queryKey: keys.claudeModels });
    },
  });
}

export function useRemoveAnthropicKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.removeAnthropicKey(),
    onSuccess: (status) => {
      storeStatus(qc, status);
      qc.removeQueries({ queryKey: keys.claudeModels });
    },
  });
}

export function useAddEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EndpointInput) => api.addEndpoint(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.llm, exact: true }),
  });
}

export function useRefreshEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.refreshEndpoint(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.llm, exact: true }),
  });
}

export function useDeleteEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteEndpoint(id),
    // deleting the active endpoint clears the active model on the server, so the status is re-read
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.llm, exact: true }),
  });
}

export function useSetActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (active: ActiveModel) => api.setActive(active),
    onSuccess: (status) => storeStatus(qc, status),
  });
}

// ---- chat ----

export const useMessages = (projectId: string) =>
  useQuery({
    queryKey: keys.messages(projectId),
    queryFn: () => api.listMessages(projectId),
    // The list only changes through this page's own mutations; a refetch would race a reply in flight.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
  });

const sendKey = (projectId: string) => ['send-message', projectId] as const;

/** What a send needs: the text, and the circuit selected on the page (the model is told which one it is). */
export interface SendInput {
  content: string;
  selectedCircuitId?: string;
}

let optimisticCounter = 0;
export const isOptimistic = (m: ChatMessage) => m.id.startsWith('pending-');

export function useSendMessage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: sendKey(projectId),
    mutationFn: ({ content, selectedCircuitId }: SendInput) => api.sendMessage(projectId, content, selectedCircuitId),
    onMutate: async ({ content }) => {
      await qc.cancelQueries({ queryKey: keys.messages(projectId) });
      const optimistic: ChatMessage = { id: `pending-${++optimisticCounter}`, role: 'user', content, kind: null, origin: null, circuitId: null, errorCode: null, findings: null, plan: null, createdCircuitIds: null, createdAt: Date.now() };
      qc.setQueryData<ChatMessage[]>(keys.messages(projectId), (list) => [...(list ?? []), optimistic]);
      return { optimisticId: optimistic.id };
    },
    onSuccess: (res, _content, ctx) => {
      qc.setQueryData<ChatMessage[]>(keys.messages(projectId), (list = []) => {
        const kept = list.filter((m) => m.id !== ctx?.optimisticId && m.id !== res.userMessage.id && m.id !== res.assistantMessage.id);
        return [...kept, res.userMessage, res.assistantMessage];
      });
      // the page selects the affected circuit from its own callback; the cache is already current
      void storeProject(qc, res.project);
    },
    onError: (_err, _content, ctx) => {
      // Roll back the optimistic message; the server list is the truth (a dropped connection may still have completed).
      qc.setQueryData<ChatMessage[]>(keys.messages(projectId), (list) => list?.filter((m) => m.id !== ctx?.optimisticId));
      return Promise.all([
        qc.invalidateQueries({ queryKey: keys.messages(projectId) }),
        qc.invalidateQueries({ queryKey: keys.project(projectId) }),
        qc.invalidateQueries({ queryKey: keys.projects }),
      ]);
    },
  });
}

/** When the current reply for this project was requested (epoch ms), or null when none is pending. Survives leaving the page. */
export function usePendingSince(projectId: string): number | null {
  const since = useMutationState({
    filters: { mutationKey: sendKey(projectId), status: 'pending' },
    select: (m) => m.state.submittedAt,
  });
  return since.length > 0 ? Math.min(...since) : null;
}

export function useClearMessages(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearMessages(projectId),
    onSuccess: () => qc.setQueryData<ChatMessage[]>(keys.messages(projectId), []),
  });
}
