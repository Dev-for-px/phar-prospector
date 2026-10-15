// Entrada do pacote dist/vendor/parquet.js (montado pelo build.mjs com esbuild).
// hyparquet lê Parquet no navegador por faixa de bytes; fzstd descompacta zstd. Os dois são JavaScript puro
// (sem WebAssembly), então a CSP do site não precisa mudar em script-src.
import { parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { decompress } from 'fzstd';

window.PPParquet = {
  metadados: parquetMetadataAsync,
  lerObjetos: parquetReadObjects,
  compressores: { ZSTD: function (entrada) { return decompress(entrada); } }
};
