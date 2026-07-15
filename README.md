# TensorArt Downloader

Userscript para [Tensor.Art](https://tensor.art/) que restaura o download de mídias quando a interface marca o conteúdo como restrito e desativa o botão nativo.

Baseado no script original de **Angry Toenail** (v0.2), com melhorias de robustez: contorno de CORS, várias fontes de URL, download real do arquivo e diagnóstico automático quando o site muda e algo quebra.

| | |
|---|---|
| **Arquivo** | [`tensorart-downloader.user.js`](./tensorart-downloader.user.js) |
| **Versão** | 0.3.7 |
| **Site** | `https://tensor.art/*` |
| **Manager** | Tampermonkey, Violentmonkey, etc. |

---

## O que faz

- Detecta itens de geração com download bloqueado na UI
- Injeta um botão **Download** no lugar do controle desabilitado
- Resolve a URL da mídia por várias fontes (JSON da task, DOM, índice de API, endpoint de download)
- Salva o arquivo de verdade (blob), em vez de só abrir em nova aba
- Em sucesso, quase não polui o console
- Em falha que parece **atualização do site**, gera um relatório `ta-dl-diag-*.json`

---

## Instalação

### Opção A — direto do GitHub (Raw)

1. Instale [Tampermonkey](https://www.tampermonkey.net/) ou [Violentmonkey](https://violentmonkey.github.io/)
2. Abra o arquivo raw do script neste repositório:
   - `tensorart-downloader.user.js` → botão **Raw** → o manager deve oferecer instalar
3. Confirme a instalação e as permissões de domínio (`api.tensor.art`, se pedir)
4. Abra [tensor.art](https://tensor.art/), faça login e recarregue com **Ctrl+F5**

### Opção B — manual

1. Abra o manager de userscripts → **Novo script**
2. Cole o conteúdo de [`tensorart-downloader.user.js`](./tensorart-downloader.user.js)
3. Salve e recarregue o Tensor.Art

> **Importante:** desative ou remova cópias antigas do mesmo script. Duas versões ativas no mesmo site podem conflitar.

### Verificação rápida

No console do navegador (`F12` → Console), ao carregar a página deve aparecer algo como:

```text
[TA-DL] v0.3.7 ready | token=yes | GM_xhr=yes | diag on update-fail only | __TADL.help()
```

| Indicador | Significado |
|---|---|
| `token=yes` | Cookie de sessão encontrado (logado) |
| `GM_xhr=yes` | `GM_xmlhttpRequest` disponível |
| `token=NO` | Faça login e recarregue |
| `GM_xhr=NO` | Reinstale o script e aceite os `@grant` / `@connect` |

---

## Como usar

1. Entre na área de gerações / histórico de tasks com mídia bloqueada na UI  
2. Aguarde o card carregar — o botão bloqueado deve virar **Download**  
3. Clique em **Download**
   - **Done** → arquivo salvo  
   - **Fail** → falhou (veja [Diagnóstico](#diagnóstico-automático))

---

## Como funciona (resumo)

1. Intercepta respostas da API que contêm `/query` (lista de tasks)
2. Localiza no DOM itens com seletor de bloqueio (`.group.cursor-not-allowed`)
3. Associa cada card ao item da API (ex.: `imageId`)
4. Monta candidatos de URL:
   1. Índice de URLs já vistas em respostas da API  
   2. Campos do JSON do item  
   3. `<img>` / `<video>` no card  
   4. Recursos de rede da página que contêm o id  
   5. `POST /works/v1/generation/image/download` (fallback)  
5. Baixa o melhor candidato via `GM_xmlhttpRequest` (evita CORS do `fetch` da página)

O “contrato” com o site (seletores, paths, campos) fica centralizado no objeto `CONTRACT` dentro do script — é o primeiro lugar a olhar se o Tensor.Art mudar.

---

## Diagnóstico automático

O script **não** gera log pesado a cada clique. Só em falhas que parecem quebra por **atualização do site/API**, por exemplo:

- payload `/query` sem `data.tasks[]`
- card da task não encontrado no DOM
- item sem `imageId` / sem URLs
- API de download falhando e zero candidatos
- todas as URLs falharam ou eram placeholder

### Quando dispara

1. Toast laranja na página  
2. Grupo no console: `[TA-DL] UPDATE DIAGNOSTIC`  
3. Download automático de `ta-dl-diag-<timestamp>.json`  
4. Histórico em `localStorage` (últimos relatórios)  
5. Debounce ~90s para o mesmo conjunto de códigos (anti-spam)

### O que o `.json` contém

| Campo | Conteúdo |
|---|---|
| `codes` | Códigos da quebra |
| `whatToFix` | Área, causa provável e o que editar |
| `contract` | Seletores/paths/campos esperados |
| `domProbe` | Se os seletores ainda batem no HTML |
| `payloadProbe` | Keys/URLs/JSON truncado do item |
| `runtime` | token, GM_xhr, índices, última API |
| `recentTrail` | Últimos eventos internos |
| `context` | Detalhes do fail |

### Códigos → onde mexer

| Código | Onde olhar no script |
|---|---|
| `PAYLOAD_NO_TASKS` | Path do `/query` (`data.tasks`) |
| `DOM_TASK_NOT_FOUND` | `CONTRACT.selectors` + `findTaskElement()` |
| `ITEM_MISSING_ID` | `CONTRACT.itemIdFields` |
| `ITEM_NO_URLS` | JSON da task sem URL (`sampleItemJson`) |
| `DOWNLOAD_API_FAIL` | Path/body/headers da API de download |
| `NO_CANDIDATES` | Coletores de URL |
| `ALL_CANDIDATES_FAILED` | CDN / blob / placeholders |
| `TOKEN_MISSING` | Cookie `ta_token_prod` / login |
| `GM_XHR_MISSING` | `@grant GM_xmlhttpRequest` |

### Ao reportar um bug

1. Reproduza o erro uma vez  
2. Anexe o `ta-dl-diag-*.json` (se tiver sido gerado)  
3. Ou cole a saída de `__TADL.diag.last()`  

Isso indica se a quebra foi de DOM, payload ou API e acelera o patch.

---

## Comandos no console

Com [tensor.art](https://tensor.art/) aberto (`F12` → Console):

```js
__TADL.help()           // guia resumido
__TADL.diag.last()      // último relatório de quebra
__TADL.diag.history()   // histórico salvo
__TADL.diag.export()    // baixar de novo o último .json
__TADL.diag.clear()     // limpar histórico
__TADL.dump()           // índices internos + último diag
__TADL.contract         // contrato (seletores/paths)
__TADL.version          // versão do script
```

O guia completo também está no **comentário no topo** do próprio `.user.js`.

---

## Solução de problemas

| Sintoma | O que tentar |
|---|---|
| Botão não aparece | Login, Ctrl+F5, uma só cópia do script, `token=yes` / `GM_xhr=yes` |
| `token=NO` | Entrar de novo no Tensor.Art e recarregar |
| `GM_xhr=NO` | Reinstalar e aceitar permissões do manager |
| Fail ao clicar | Abrir `ta-dl-diag-*.json` se baixou; ver `codes` e `whatToFix` |
| Só imagem “forbidden” | Backend pode devolver placeholder; o script tenta JSON/DOM antes da API |
| Quebrou após redesign do site | Provável mudança de seletor/API → relatório de diagnóstico |

---

## Privacidade

- Roda apenas em `tensor.art` (conforme `@match`)
- Usa o token de sessão já presente no navegador para a API do próprio Tensor.Art
- **Não** envia dados para servidores de terceiros
- Relatórios ficam no seu PC (download local + `localStorage` do site)
- Como todo userscript: revise o código antes de instalar

---

## Limitações

- Depende do layout e das APIs atuais do Tensor.Art  
- Se o backend parar de expor a mídia no JSON e só servir placeholder, pode ser impossível recuperar o arquivo só pelo browser  
- A assinatura HMAC da API de download usa o esquema compatível com o script 0.2; se a API passar a validar sign de forma rígida, essa parte precisará de atualização  
- Uso sob sua responsabilidade, de acordo com os [termos do Tensor.Art](https://tensor.art/) e a legislação aplicável  

---

## Estrutura do repositório

```text
tensorart-downloader/
├── README.md                      ← este arquivo
└── tensorart-downloader.user.js   ← userscript (instale este)
```

Opcional no futuro:

```text
docs/
└── greasyfork-additional-info.html   ← texto HTML para Greasy Fork
```

---

## Changelog (resumo)

| Versão | Notas |
|---|---|
| **0.3.7** | Guia embutido no código + `__TADL.help()` |
| **0.3.6** | Diagnóstico automático em falhas por atualização do site |
| **0.3.5** | Fix: candidatos não zerados + headers de download estáveis |
| **0.3.2–0.3.4** | CORS via GM_xhr, multi-fonte de URL, índice de mídia |
| **0.2** | Original (Angry Toenail) |

Detalhes e checklist de manutenção estão no cabeçalho comentado de `tensorart-downloader.user.js`.

---

## Créditos

- Ideia e base original: **Angry Toenail** — [TensorArt Downloader 0.2](https://gist.github.com/angrytoenail/bef6d23f43430f857e5c94cfc241954e)
- Refinamentos: multi-fonte de URL, `GM_xmlhttpRequest`, download em blob, diagnóstico de quebra, documentação

---

## Licença

GNU AGPLv3

---

## Contribuindo

Pull requests são bem-vindos, especialmente:

- Ajustes de seletores DOM após redesign do site  
- Novos campos de URL no JSON da task  
- Melhorias no diagnóstico (`CODE_HINTS`, probes)  
- Traduções do README  

Para bugs: abra uma issue com o `ta-dl-diag-*.json` anexado, sempre que possível.
