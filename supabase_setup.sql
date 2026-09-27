-- =========================================================================
-- STUDIO LETÍCIA - SCRIPT SQL DE CONFIGURAÇÃO DO BANCO SUPABASE (GRATUITO)
-- Cole este script no SQL Editor do seu projeto Supabase e clique em RUN
-- =========================================================================

-- 1. Cria a tabela de solicitações de agendamento online das clientes
CREATE TABLE IF NOT EXISTS public.solicitacoes_agendamento (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_nome TEXT NOT NULL,
    cliente_whatsapp TEXT NOT NULL,
    servico_id TEXT NOT NULL,
    servico_nome TEXT NOT NULL,
    servico_preco NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    duracao_min INTEGER NOT NULL DEFAULT 60,
    data DATE NOT NULL,
    horario TEXT NOT NULL,
    observacoes TEXT,
    motivo_recusa TEXT,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'confirmado', 'recusado')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Habilita Row Level Security (RLS) para segurança
ALTER TABLE public.solicitacoes_agendamento ENABLE ROW LEVEL SECURITY;

-- 3. Políticas de Acesso (Permite clientes criarem pedidos e consultarem o status)
DROP POLICY IF EXISTS "Permitir criacao publica de agendamento" ON public.solicitacoes_agendamento;
CREATE POLICY "Permitir criacao publica de agendamento"
ON public.solicitacoes_agendamento
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura publica de agendamento" ON public.solicitacoes_agendamento;
CREATE POLICY "Permitir leitura publica de agendamento"
ON public.solicitacoes_agendamento
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Permitir atualizacao de agendamento" ON public.solicitacoes_agendamento;
CREATE POLICY "Permitir atualizacao de agendamento"
ON public.solicitacoes_agendamento
FOR UPDATE
TO anon, authenticated
USING (true);

-- 4. Habilita sincronização em Tempo Real (Realtime)
ALTER PUBLICATION supabase_realtime ADD TABLE public.solicitacoes_agendamento;
