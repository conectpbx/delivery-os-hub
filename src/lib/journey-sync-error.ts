/** Do not expose raw database messages, request headers or account identifiers in the UI. */
export function journeySyncError(error: unknown): string | null {
  if (!error) return null;
  const value = error as { code?: string; status?: number; message?: string; name?: string };
  if (["PGRST202", "42883", "42P01", "PGRST205"].includes(value.code ?? ""))
    return "Sincronização de jornada indisponível no servidor. É necessário aplicar a migração de sincronização do banco; atualizar o aplicativo não aplica essa migração.";
  if (value.status === 401 || ["PGRST301", "PGRST303"].includes(value.code ?? ""))
    return "Sua sessão precisa ser renovada para sincronizar a jornada. Entre novamente na conta. A jornada deste dispositivo foi preservada.";
  if (value.code === "42501" || value.status === 403)
    return "O servidor recusou a sincronização da jornada. Verifique as permissões da conta e da função de sincronização no banco. A jornada local foi preservada.";
  if (["22023", "22007", "22P02", "22008"].includes(value.code ?? ""))
    return "O servidor recusou os dados da jornada. Confira o horário do dispositivo. A jornada local foi preservada para recuperação.";
  if (
    value.message === "offline" ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  )
    return "Sem conexão. A jornada está salva neste dispositivo e será sincronizada ao reconectar.";
  return "Não foi possível sincronizar a jornada. Confira a conexão e tente novamente. A jornada deste dispositivo foi preservada.";
}
