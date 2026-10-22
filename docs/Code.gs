/**
 * Layouts das Lojas - Molicenter
 * Backend em Google Apps Script que le e grava direto nas pastas do Drive:
 *   Layouts / Loja XX / <corredor> / fotos dos modulos
 *   Layouts / Loja XX / <corredor> / Histórico / fotos antigas
 *
 * Implantar: Implantar > Nova implantação > App da Web
 *   Executar como: Eu  |  Quem pode acessar: Qualquer pessoa
 *
 * Senha do administrador: Configurações do projeto > Propriedades do script
 *   ADMIN_SENHA = sua senha
 */

// ID da pasta "Layouts" (o trecho final do link da pasta no Drive)
const PASTA_RAIZ_ID = '1PiYmXWnQomnGX0OoYtzmbbtF9UrUVdci';

const NOME_HISTORICO = 'Histórico';
const FUSO = 'America/Sao_Paulo';
const CACHE_SEG = 600; // 10 minutos

// ---------------------------------------------------------------- entrada

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    switch (p.acao) {
      case 'estrutura': return json(estrutura_());
      case 'fotos':     return json(fotos_(p.pasta, p.fresco === '1'));
      case 'ping':      return json({ ok: true, hora: agora_() });
      default:          return json({ erro: 'Ação inválida' });
    }
  } catch (err) {
    return json({ erro: String(err.message || err) });
  }
}

function doPost(e) {
  let d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ erro: 'Requisição inválida' });
  }
  try {
    checarSenha_(d.senha);
    if (d.acao === 'login') return json({ ok: true });

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      // ações sobre as pastas dos corredores (criar / renomear / excluir)
      if (d.acao === 'criarCorredor' || d.acao === 'renomearCorredor' || d.acao === 'excluirCorredor') {
        let r;
        if (d.acao === 'criarCorredor') r = criarCorredor_(d.loja, d.nome);
        else if (d.acao === 'renomearCorredor') r = renomearCorredor_(d.pasta, d.nome);
        else r = excluirCorredor_(d.pasta);
        CacheService.getScriptCache().remove('estrutura');
        return json(Object.assign({ ok: true }, r, { estrutura: estrutura_() }));
      }
      const pasta = pastaCorredor_(d.pasta);
      let r;
      switch (d.acao) {
        case 'enviar':  r = enviar_(pasta, d); break;
        case 'remover': r = remover_(pasta, Number(d.modulo)); break;
        case 'mover':   r = mover_(pasta, Number(d.modulo), Number(d.direcao)); break;
        case 'ordenar': r = ordenar_(pasta, d.ordem); break;
        case 'restaurar': r = restaurar_(pasta, d.fotoId); break;
        default: throw new Error('Ação inválida');
      }
      limparCache_(pasta.getId());
      return json(Object.assign({ ok: true }, r, { fotos: fotos_(pasta.getId(), true) }));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json({ erro: String(err.message || err) });
  }
}

// ---------------------------------------------------------------- leitura

function estrutura_() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('estrutura');
  if (c) return JSON.parse(c);

  const raiz = DriveApp.getFolderById(PASTA_RAIZ_ID);
  const lojas = [];
  const itLojas = raiz.getFolders();
  while (itLojas.hasNext()) {
    const fl = itLojas.next();
    const corredores = [];
    const itC = fl.getFolders();
    while (itC.hasNext()) {
      const fc = itC.next();
      corredores.push({ id: fc.getId(), nome: fc.getName().trim() });
    }
    lojas.push({ id: fl.getId(), nome: fl.getName().trim(), corredores: corredores });
  }
  const r = { lojas: lojas, gerado: agora_() };
  try { cache.put('estrutura', JSON.stringify(r), CACHE_SEG); } catch (e) {}
  return r;
}

function fotos_(pastaId, fresco) {
  const cache = CacheService.getScriptCache();
  const chave = 'f_' + pastaId;
  if (!fresco) {
    const c = cache.get(chave);
    if (c) return JSON.parse(c);
  }
  const pasta = pastaCorredor_(pastaId);
  const lista = imagens_(pasta).map(infoFoto_);
  const hist = pastaHistorico_(pasta, false);
  const historico = hist ? imagens_(hist).map(infoFoto_).reverse() : [];
  const r = { pasta: pastaId, nome: pasta.getName(), fotos: lista, historico: historico };
  try { cache.put(chave, JSON.stringify(r), CACHE_SEG); } catch (e) {}
  return r;
}

function infoFoto_(f) {
  return {
    id: f.getId(),
    nome: f.getName(),
    // data da foto = quando o arquivo entrou no Drive (renomear ou reordenar muda a "modificação" do Drive)
    atualizado: Utilities.formatDate(f.getDateCreated(), FUSO, 'dd/MM/yyyy HH:mm'),
    criado: Utilities.formatDate(f.getDateCreated(), FUSO, 'dd/MM/yyyy HH:mm'),
    tamanho: f.getSize()
  };
}

// ---------------------------------------------------------------- escrita

function enviar_(pasta, d) {
  if (!d.base64) throw new Error('Foto não recebida');
  const lista = normalizar_(pasta);
  const mime = d.mime || 'image/jpeg';
  const ext = mime === 'image/png' ? '.png' : '.jpg';
  const bytes = Utilities.base64Decode(d.base64);
  let n;

  if (d.modulo) {
    n = Number(d.modulo);
    const antiga = lista[n - 1];
    if (!antiga) throw new Error('Módulo ' + n + ' não existe');
    arquivar_(pasta, antiga, n, 'substituída');
  } else {
    n = lista.length + 1;
  }

  const blob = Utilities.newBlob(bytes, mime, nomeModulo_(n) + ext);
  const novo = pasta.createFile(blob);
  novo.setDescription('Enviada pelo site em ' + agora_());
  compartilhar_(novo);
  return { modulo: n, id: novo.getId() };
}

function remover_(pasta, n) {
  const lista = normalizar_(pasta);
  const f = lista[n - 1];
  if (!f) throw new Error('Módulo ' + n + ' não existe');
  arquivar_(pasta, f, n, 'removida');
  renumerar_(imagens_(pasta));
  return { modulo: n };
}

function mover_(pasta, n, direcao) {
  const lista = normalizar_(pasta);
  const alvo = n + (direcao < 0 ? -1 : 1);
  if (!lista[n - 1] || !lista[alvo - 1]) throw new Error('Não dá para mover');
  const a = lista[n - 1], b = lista[alvo - 1];
  lista[n - 1] = b; lista[alvo - 1] = a;
  renumerar_(lista);
  return { modulo: alvo };
}

/** Recebe a lista de IDs na nova ordem (arrastar e soltar no site) e renumera os módulos. */
function ordenar_(pasta, ordem) {
  const lista = normalizar_(pasta);
  if (!Array.isArray(ordem) || ordem.length !== lista.length) throw new Error('As fotos mudaram enquanto você ordenava. Recarregue a página.');
  const porId = {};
  lista.forEach(function (f) { porId[f.getId()] = f; });
  const nova = ordem.map(function (id) { return porId[id]; });
  if (nova.some(function (f) { return !f; })) throw new Error('As fotos mudaram enquanto você ordenava. Recarregue a página.');
  renumerar_(nova);
  return {};
}

function restaurar_(pasta, fotoId) {
  const hist = pastaHistorico_(pasta, false);
  if (!hist) throw new Error('Sem histórico');
  const f = DriveApp.getFileById(fotoId);
  const pais = f.getParents();
  if (!pais.hasNext() || pais.next().getId() !== hist.getId()) throw new Error('Foto não pertence a este corredor');
  const lista = normalizar_(pasta);
  const n = lista.length + 1;
  f.moveTo(pasta);
  f.setName(nomeModulo_(n) + extensao_(f.getName()));
  return { modulo: n };
}

// ---------------------------------------------------------------- pastas dos corredores

function nomeCorredorValido_(nome) {
  nome = String(nome || '').replace(/\s+/g, ' ').trim();
  if (!nome) throw new Error('Informe o nome do corredor');
  if (nome.length > 80) throw new Error('Nome muito comprido');
  if (nome.toLowerCase() === NOME_HISTORICO.toLowerCase()) throw new Error('Nome reservado');
  return nome;
}

function nomeRepetido_(loja, nome, ignorarId) {
  const it = loja.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getId() !== ignorarId && f.getName().trim().toLowerCase() === nome.toLowerCase()) return true;
  }
  return false;
}

function pastaLoja_(id) {
  if (!id) throw new Error('Loja não informada');
  const loja = DriveApp.getFolderById(id);
  const p = loja.getParents();
  if (!p.hasNext() || p.next().getId() !== PASTA_RAIZ_ID) throw new Error('Loja fora da pasta Layouts');
  return loja;
}

function criarCorredor_(lojaId, nome) {
  const loja = pastaLoja_(lojaId);
  nome = nomeCorredorValido_(nome);
  if (nomeRepetido_(loja, nome, null)) throw new Error('Já existe um corredor com esse nome nesta loja');
  const nova = loja.createFolder(nome);
  nova.setDescription('Criada pelo site em ' + agora_());
  return { id: nova.getId() };
}

function renomearCorredor_(id, nome) {
  const pasta = pastaCorredor_(id);
  nome = nomeCorredorValido_(nome);
  const loja = pasta.getParents().next();
  if (nomeRepetido_(loja, nome, pasta.getId())) throw new Error('Já existe um corredor com esse nome nesta loja');
  pasta.setName(nome);
  return { id: pasta.getId() };
}

/** Só exclui corredor sem nenhuma foto (nem no histórico). Vai para a lixeira do Drive. */
function excluirCorredor_(id) {
  const pasta = pastaCorredor_(id);
  const hist = pastaHistorico_(pasta, false);
  if (imagens_(pasta).length || (hist && imagens_(hist).length)) throw new Error('Este corredor tem fotos. Remova as fotos antes de excluir.');
  pasta.setTrashed(true);
  return { id: id };
}

// ---------------------------------------------------------------- apoio

/** Renomeia as fotos do corredor para "Módulo 01", "Módulo 02"... mantendo a ordem atual. */
function normalizar_(pasta) {
  const lista = imagens_(pasta);
  const ok = lista.every(function (f, i) {
    return f.getName().indexOf(nomeModulo_(i + 1) + '.') === 0;
  });
  if (!ok) renumerar_(lista);
  return lista;
}

function renumerar_(lista) {
  // o Drive aceita nomes repetidos, então basta renomear só as que mudaram de posição
  lista.forEach(function (f, i) {
    const nome = nomeModulo_(i + 1) + extensao_(f.getName());
    if (f.getName() !== nome) f.setName(nome);
  });
}

function arquivar_(pasta, f, n, motivo) {
  const hist = pastaHistorico_(pasta, true);
  const quando = Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd HHmm');
  f.setName(nomeModulo_(n) + ' - ' + motivo + ' ' + quando + extensao_(f.getName()));
  f.moveTo(hist);
}

function imagens_(pasta) {
  const out = [];
  const it = pasta.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (String(f.getMimeType()).indexOf('image/') === 0) out.push(f);
  }
  const col = function (a, b) {
    return a.getName().localeCompare(b.getName(), 'pt-BR', { numeric: true, sensitivity: 'base' });
  };
  return out.sort(col);
}

function pastaHistorico_(pasta, criar) {
  const it = pasta.getFoldersByName(NOME_HISTORICO);
  if (it.hasNext()) return it.next();
  if (!criar) return null;
  return pasta.createFolder(NOME_HISTORICO);
}

/** Garante que a pasta é um corredor dentro de Layouts/Loja XX. */
function pastaCorredor_(id) {
  if (!id) throw new Error('Corredor não informado');
  const pasta = DriveApp.getFolderById(id);
  const p1 = pasta.getParents();
  if (!p1.hasNext()) throw new Error('Corredor inválido');
  const loja = p1.next();
  const p2 = loja.getParents();
  if (!p2.hasNext() || p2.next().getId() !== PASTA_RAIZ_ID) throw new Error('Corredor fora da pasta Layouts');
  return pasta;
}

function compartilhar_(f) {
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
}

function checarSenha_(senha) {
  const certa = PropertiesService.getScriptProperties().getProperty('ADMIN_SENHA');
  if (!certa) throw new Error('Senha do administrador não configurada no Apps Script');
  if (String(senha || '') !== certa) {
    Utilities.sleep(800);
    throw new Error('Senha incorreta');
  }
}

function limparCache_(pastaId) {
  CacheService.getScriptCache().removeAll(['f_' + pastaId, 'estrutura']);
}

function nomeModulo_(n) { return 'Módulo ' + (n < 10 ? '0' + n : String(n)); }
function extensao_(nome) { const m = /\.[a-z0-9]+$/i.exec(nome); return m ? m[0].toLowerCase() : '.jpg'; }
function agora_() { return Utilities.formatDate(new Date(), FUSO, 'dd/MM/yyyy HH:mm'); }
function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- utilitários (rodar à mão no editor)

/** Rode uma vez: deixa todas as fotos já existentes visíveis pelo link (necessário para o site mostrar). */
function liberarFotosExistentes() {
  const raiz = DriveApp.getFolderById(PASTA_RAIZ_ID);
  let n = 0;
  const percorrer = function (pasta) {
    const fs = pasta.getFiles();
    while (fs.hasNext()) { const f = fs.next(); if (String(f.getMimeType()).indexOf('image/') === 0) { compartilhar_(f); n++; } }
    const ps = pasta.getFolders();
    while (ps.hasNext()) percorrer(ps.next());
  };
  percorrer(raiz);
  Logger.log(n + ' fotos liberadas');
}

/** Rode para testar se o script enxerga a pasta Layouts. */
function testar() {
  const e = estrutura_();
  e.lojas.forEach(function (l) { Logger.log(l.nome + ': ' + l.corredores.length + ' corredores'); });
}
