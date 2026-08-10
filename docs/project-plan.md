# StreamTube — Planejamento Geral do Projeto

## 1. Visão Geral

O StreamTube é uma plataforma de compartilhamento de vídeos onde usuários cadastrados podem fazer upload, gerenciar e publicar vídeos. Usuários anônimos podem assistir livremente, enquanto funcionalidades sociais como comentários, inscrições e likes são exclusivas de usuários autenticados.

### Principais Características

- **Acesso anônimo:** qualquer pessoa pode assistir vídeos sem cadastro.
- **Cadastro com confirmação:** registro via e-mail com confirmação obrigatória. O prefixo do e-mail se torna o nome do canal.
- **Upload robusto:** suporte a arquivos de até 10GB sem impactar a performance do sistema.
- **Gerenciamento de vídeos:** rascunhos, edição de informações, visibilidade pública/unlisted, thumbnails customizadas.
- **Interações sociais:** likes/dislikes, comentários com respostas, inscrição em canais.
- **Canais:** cada usuário possui um canal com página pública e painel de administração.
- **Recuperação de senha:** fluxo completo de reset via e-mail.
- **Sugestões:** vídeos relacionados por categoria exibidos na sidebar.

### Stack Tecnológica

- **Frontend:** Next.js
- **Backend:** Nest.js
- **Banco de dados:** PostgreSQL

---

## 2. Arquitetura do Software

Veja o diagrama de arquitetura do projeto: [software-arch.mermaid](diagrams/software-arch.mermaid)

---

## 3. Fases do Projeto

> Status: ✅ concluída · ✅ (backend) concluída apenas no backend, UI ainda pendente · sem marcação = planejada.

### Fase 01 — Configuração Base do Projeto ✅

Preparação de toda a fundação do projeto: repositório, ambiente de desenvolvimento, projetos Next.js e Nest.js, banco de dados PostgreSQL e serviços auxiliares.

- [x] Repositório com estrutura de monorepo (frontend e backend)
- [x] Projeto Next.js (frontend) e Nest.js (backend) inicializados
- [x] Ambiente de desenvolvimento local com todos os serviços via Docker Compose
- [x] Estrutura inicial do banco de dados PostgreSQL (schema, migrations e seeds)
- [x] Fundação de IA para coding.

**Entregáveis:** ambiente de desenvolvimento funcional, banco de dados configurado.

---

### Fase 02 — Cadastro, Login e Gerenciamento de Conta ✅

> Depende de: Fase 01

Fluxo completo de criação de conta, confirmação por e-mail, login, logout e recuperação de senha.

- [x] Serviço de envio de e-mails transacionais
- [x] Cadastro de usuário com e-mail e senha
- [x] Criação automática do canal do usuário a partir do prefixo do e-mail
- [x] Confirmação de conta via e-mail com link de ativação
- [x] Login e controle de sessão do usuário
- [x] Logout
- [x] Recuperação de senha: solicitação via e-mail → link com token → redefinição
- [x] Telas de cadastro, login, confirmação de conta e recuperação de senha

**Entregáveis:** fluxo completo de cadastro → confirmação → login → recuperação de senha funcionando. Canal criado automaticamente para cada usuário.

---

### Fase 03 — Upload e Processamento de Vídeos ✅ (backend)

> Depende de: Fase 01, Fase 02

Upload de arquivos grandes sem travar o sistema, processamento automático do vídeo e geração de URL única.

- [x] Serviço de armazenamento de arquivos (vídeos e thumbnails) — `StorageService` (MinIO/S3, multipart upload)
- [x] Serviço de processamento em segundo plano (filas) — `QueueModule` (BullMQ/Redis) + `video-worker`
- [x] Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance — multipart upload via `POST /videos` + `POST /videos/:id/complete-upload`
- [x] Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- [x] Processamento automático do vídeo após upload (extração de duração e metadados) — `VideoProcessingProcessor` (fluent-ffmpeg)
- [x] Geração automática de thumbnail a partir de um frame do vídeo
- [x] URL única por vídeo, sem conflito com outros vídeos — slug único com retry em colisão
- [x] Reprodução via streaming (sem necessidade de download completo) — `GET /videos/:slug/stream` (range requests)
- [x] Download do vídeo pelo usuário — `GET /videos/:slug/download`

**Entregáveis:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas. **Backend concluído** (`nestjs-project`, módulos `videos`, `storage`, `queue`, `video-worker`); **UI de upload/gerenciamento no frontend ainda não implementada** — fica para a Fase 04, que já cobre o painel de gerenciamento de vídeos.

---

### Fase 04 — Gerenciamento de Vídeos e Canal

> Depende de: Fase 02, Fase 03

Edição das informações do vídeo, fluxo de rascunho e publicação, painel de administração do canal e página pública.

- Categorias de vídeo disponíveis na plataforma
- Edição das informações do vídeo: título, descrição, categoria e thumbnail customizada
- Visibilidade do vídeo: público (aparece para todos) ou unlisted (somente via link)
- Fluxo de rascunho → publicação
- Painel de gerenciamento de vídeos do canal (thumbnail, título, visualizações, likes, comentários, tempo de publicação e status)
- Edição de vídeos a partir do painel
- Edição das informações do canal: nickname, nome e descrição
- Página pública do canal com informações e listagem de vídeos

**Entregáveis:** edição completa de vídeos, rascunho/publicação, painel de gerenciamento, edição de canal, página pública do canal.

---

### Fase 05 — Página de Visualização do Vídeo

> Depende de: Fase 03, Fase 04

Página onde o usuário assiste ao vídeo com player funcional, descrição, sugestões e acesso anônimo.

- Player de vídeo com controles: play/pause, volume e barra de progresso
- Layout da página: vídeo principal + informações + sidebar com sugestões
- Descrição do vídeo com expansão/recolhimento
- Contagem de visualizações
- Sugestões de vídeos da mesma categoria na sidebar
- Acesso anônimo à visualização de vídeos
- Botão de download do vídeo
- Vídeos unlisted acessíveis apenas via link direto (sem aparecer em listagens)

**Entregáveis:** página de visualização com player funcional, sidebar de sugestões, download e acesso anônimo.

---

### Fase 06 — Interações Sociais (Likes, Comentários, Inscrições)

> Depende de: Fase 02, Fase 05

Likes/dislikes em vídeos e comentários, comentários com respostas e inscrição em canais.

- Like e dislike em vídeos (usuários autenticados)
- Comentários em vídeos (usuários autenticados)
- Respostas a comentários (comentários aninhados)
- Like e dislike em comentários (usuários autenticados)
- Inscrição em canais (seguir/deixar de seguir)
- Área de canais seguidos com acesso rápido aos vídeos
- Contagem de inscritos na página do canal
- Interface completa de comentários, likes e inscrições

**Entregáveis:** likes/dislikes funcionando, comentários com respostas, inscrição em canais, listagem de canais seguidos.

---

### Fase 07 — Página Inicial, Busca e Finalização

> Depende de: todas as fases anteriores

Home page com listagem de vídeos, busca, navegação geral, responsividade e preparação para produção.

- Página inicial com grid de vídeos (thumbnail, título, canal, visualizações e tempo de publicação)
- Filtro de vídeos por categoria na home
- Barra de busca (pesquisa por título e canal)
- Header/navbar com logo, barra de busca, botão de login/avatar e navegação
- Paginação ou scroll infinito nas listagens de vídeos
- Layout responsivo para dispositivos móveis
- Testes dos fluxos principais da plataforma
- Ambiente de produção e deploy

**Entregáveis:** home page, busca, navegação, responsividade, testes realizados e ambiente de produção configurado.

---

## 4. Pontos de Atenção

- **Upload de arquivos grandes:** o upload de até 10GB precisa ser feito de forma que não trave o sistema e permita retomar em caso de falha de conexão.
- **Processamento de vídeos:** a extração de informações do vídeo é pesada e deve acontecer em segundo plano, sem bloquear o usuário.
- **URLs únicas:** cada vídeo precisa de uma URL curta e única que nunca conflite com outro vídeo.
- **Armazenamento:** vídeos grandes consomem muito espaço. É importante planejar o crescimento e os custos de armazenamento desde o início.
- **Streaming:** o vídeo deve começar a ser reproduzido sem que o usuário precise baixar o arquivo inteiro.
- **Comentários aninhados:** definir até quantos níveis de resposta serão permitidos para manter a interface organizada.
- **Like/dislike anônimo:** como qualquer usuário pode dar like/dislike, é preciso evitar abusos (ex: múltiplos likes do mesmo usuário).