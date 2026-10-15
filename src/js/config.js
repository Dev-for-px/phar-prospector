// Configuração pública do site. A chave abaixo é a chave "publishable" do Supabase:
// ela pode ficar no navegador, porque quem protege os dados são as regras do banco (RLS).
// A chave secreta (service_role) nunca entra neste repositório.
window.PP_CONFIG = {
  nome: 'PHAR Prospector',
  url: 'https://megkurlpjylmxjndynoo.supabase.co',
  chave: 'sb_publishable_Ete35T600mQmtXi-S4IEhw_jLunudad',
  // Base pública da Receita (Parquet no Hugging Face), lida pela aba Buscar leads. Vazio = ainda não publicada.
  // No computador (npm run dev com RECEITA_DIR) a base vem do servidor local.
  receita: window.location.hostname === 'localhost' ? '/receita/' : ''
};
