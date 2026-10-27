# Configuração do Supabase

O aplicativo está separado em `volei.html`, `styles.css` e `app.js`. O banco
configurado é **Supabase**, não Firebase. O site lê os dados publicamente e
permite gravação apenas na conta administrativa.

## Conectar o projeto

1. Crie um projeto no [Supabase](https://supabase.com/dashboard).
2. Em **Project Settings > API**, copie a Project URL e a chave pública
   (publishable/anon) para `supabase-config.js`.
   **Nunca use a chave `service_role` no navegador.**
3. Em **Authentication > Providers**, mantenha Email habilitado e desative
   cadastro público de usuários.
4. Em **Authentication > Users**, crie a única conta administrativa:
   - Email: `admin@voleigo.app` (ou altere `ADMIN_EMAIL` em
     `supabase-config.js`).
   - Defina a senha geral fora dos arquivos do site.
   - Confirme o endereço de email, se a confirmação estiver habilitada.
   - Copie o ID da conta e substitua `COLE_UID_DO_ADMIN` em
     `supabase-config.js` e nas políticas de `supabase-schema.sql`.
5. Abra **SQL Editor**, substitua as ocorrências de `COLE_UID_DO_ADMIN` no
   arquivo `supabase-schema.sql` pelo ID da conta e execute o script completo.
6. Publique os arquivos estáticos (`volei.html`, `styles.css`, `app.js`,
   `supabase-config.js` e `vercel.json`) em uma hospedagem HTTPS. A configuração
   da Vercel neste projeto direciona a rota `/` para `volei.html`.

## Publicar na Vercel

O projeto é um site estático: não precisa de etapa de build nem de variáveis de
ambiente da Vercel. Mantenha os arquivos acima na mesma pasta e publique essa
pasta como raiz do projeto. O domínio da Vercel usa HTTPS e o app conecta
diretamente ao Supabase.

Após publicar, abra a URL `/` do projeto. O indicador deve mostrar
**Sincronizado**. Em seguida, teste leitura como visitante e edição após entrar
com a conta administrativa.

Não publique antes de preencher `supabase-config.js` com a URL, a chave pública
e o UID corretos, e de executar `supabase-schema.sql` no projeto Supabase. A
chave `anon`/publishable é destinada ao cliente e protegida pelas políticas RLS;
jamais publique uma chave `service_role` ou a senha administrativa.

Para testar localmente, sirva a pasta por um servidor HTTP (por exemplo,
Live Server no VS Code); abrir `volei.html` diretamente como arquivo não
carrega os módulos JavaScript.

Sem URL/chave/UID preenchidos, o aplicativo indica “Banco não configurado”,
permanece em modo visitante e não grava dados localmente. Os dados salvos
anteriormente no navegador não são importados.

## Estrutura do banco

- `games`: eventos do calendário.
- `players`: jogadores.
- `app_state`: documentos compartilhados do sorteio, campeonato e placar.

O SQL configura Row Level Security: visitantes têm leitura e somente o UID
administrativo pode criar, atualizar ou apagar dados. Também habilita o Realtime
para as três tabelas.

O formulário solicita a senha geral e a envia diretamente ao Supabase Auth. A
sessão administrativa fica somente na memória da página e termina ao recarregar.
Todas as pessoas com a senha compartilham a mesma conta e os mesmos poderes.
