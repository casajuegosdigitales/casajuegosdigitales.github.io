@echo off
chcp 65001 >nul
cd /d "%~dp0"
set GAMES_EXCEL=%~dp0GAMES LIST - AUTO.xlsx
set DOLAR_DIGITAL_VENTA=1561
echo.
echo === Casa Juegos Digitales - Actualizar precios ===
echo 4 tiendas: Kinguin, Eneba, Driffle, Loaded
echo Excel: %GAMES_EXCEL%
echo.
node scripts\actualizar-precios.cjs --links-only %*
if errorlevel 1 (
  echo.
  echo Termino con errores parciales. Revisa la salida.
  pause
  exit /b 1
)
echo.
echo Listo.
echo - Web: js\catalog.js
echo - Guia compra (repo): guia-compras.json / .csv
echo - Copia privada PC: %%USERPROFILE%%\Downloads\CJD-operaciones\
echo.
echo Subi los cambios a GitHub para publicar la web.
pause
