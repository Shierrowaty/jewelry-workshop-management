import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDataError } from "../quotes/data/storage";
import { getKnowledgeRepository, KnowledgeError } from "./repository";

export function knowledgeError(error: unknown) { return error instanceof KnowledgeError ? error.message : localDataError(error); }
export function useKnowledge() {
  const [attempt, setAttempt] = useState(0);
  const result = useLiveQuery(async () => {
    try { return { data: await getKnowledgeRepository().list(), error: null }; }
    catch (error) { return { data: undefined, error: knowledgeError(error) }; }
  }, [attempt]);
  return { result, retry: () => setAttempt(value => value + 1) };
}
