# Layouts das Lojas — passo a passo de instalação

O site lê e grava **direto nas pastas atuais do Drive** (Layouts / Loja XX / corredor).
Não precisa mudar nada na estrutura de pastas.

## 1. Apps Script (o "servidor" que acessa o Drive)

1. Acesse script.google.com com a conta dona da pasta Layouts → **Novo projeto**. Nome: `Layouts Lojas`.
2. Apague o conteúdo e cole o arquivo `apps_script/Code.gs`.
3. Confira na linha `PASTA_RAIZ_ID` o ID da pasta **Layouts**, que é o final do link
   `drive.google.com/drive/folders/XXXX`. Eu li `1PiYmXWnQomnGX0OoYtzmbbtF9UrUVdci` no seu print, mas confirme copiando do navegador.
4. Vá em ⚙ **Configurações do projeto → Propriedades do script → Adicionar**:
   `ADMIN_SENHA` = a senha do administrador.
5. Selecione a função **testar** → **Executar** → autorize o acesso ao Drive.
   O log deve mostrar "Loja 01: 25 corredores…".
6. Selecione **liberarFotosExistentes** → **Executar** (uma vez só). Assim as fotos atuais ficam visíveis pelo link, o que é necessário para o site exibir.
   *(Alternativa: compartilhar a pasta Layouts como "Qualquer pessoa com o link → Leitor".)*
7. **Implantar → Nova implantação → App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   Copie a URL que termina em `/exec`.

> Se alterar o Code.gs depois: Implantar → Gerenciar implantações → ✏ → Versão: **Nova versão**. Desse jeito a URL continua a mesma.

## 2. Site (GitHub Pages, igual aos outros)

1. Crie o repositório `Molicenter/Layouts-Lojas` (pode ser público, porque a senha fica no Apps Script e não no código).
2. Em `index.html`, cole a URL do passo 1.7 em `const API_URL = '';`.
3. Suba os arquivos da pasta `site/`: index.html, manifest.json, sw.js, icon-192.png e icon-512.png.
4. Settings → Pages → Branch `main` / root → Save.
   O endereço será `molicenter.github.io/Layouts-Lojas`.
5. O ícone é provisório. Se quiser, substitua icon-192/512.png pelo passarinho, como nos outros apps.

## 3. Uso

- **Gerentes e equipe:** abrem pelo QR ou pelo link, escolhem a loja e o corredor e veem as fotos (toque para ampliar, 🔍 para zoom, arrastar para o próximo módulo). Não precisam de senha.
- **Admin:** toque em 🔒, informe a senha e entre no corredor:
  - **📷 Trocar foto**: abre a câmera, envia em até 4000 px e move a antiga para a subpasta **Histórico** com data.
  - **＋ Adicionar módulo**, **◀ ▶** para reordenar, **🗑** para remover (a foto vai para o Histórico).
  - **Histórico → ↺ Restaurar** traz uma foto antiga de volta como último módulo.
  - Na tela da loja: **▦ QR Codes para imprimir**. A 1ª página traz o QR da loja (para a 1ª gôndola) e as seguintes trazem um QR por corredor.
  - **↻ Atualizar corredores**: use depois de criar ou renomear pastas no Drive (a lista fica em cache por 10 min).

Observações:
- Na 1ª alteração em um corredor, as fotos dele são renomeadas para "Módulo 01, 02…", mantendo a ordem atual.
- Foto recém-enviada pode demorar alguns segundos para aparecer, enquanto o Drive gera a miniatura.
- Sem a API_URL configurada, o site abre em **modo demonstração** (senha: `demo`).
