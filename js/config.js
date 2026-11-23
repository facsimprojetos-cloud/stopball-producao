// Configuração pública do app (a chave publicável do Supabase é feita para ficar no front-end;
// a proteção dos dados é feita por login + RLS + funções com checagem de perfil no banco).
export const SUPABASE_URL = 'https://swledaccsxcqpffjvtdh.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_CP90sN-553zB3BfUW05NTA_S5ZVPNrP';
export const SCHEMA = 'stopball';
export const EMPRESA = 'STOPBALL';
// Logins por área (sem e-mail real) viram <usuario>@stopball.app
export const DOMINIO_INTERNO = 'stopball.app';
export const BUCKET = 'stopball';
// Arquivos antigos do AppSheet (GESTÃO_Files_/...) ficam na pasta do app no Google Drive
export const PASTA_APPSHEET = 'https://drive.google.com/drive/search?q=';

// Áreas = painéis (antigos dashboards do AppSheet). O perfil com o mesmo nome movimenta os setores da área.
export const AREAS = [
  ['design', 'Design'],
  ['sublimado', 'Produção sublimado'],
  ['uniforme', 'Produção uniforme'],
  ['logistica', 'Logística interna'],
  ['bolsas', 'Facção de bolsas'],
  ['acabamento', 'Acabamento'],
];
