@echo off
echo PACKAGING FOR WINDOWS
npm run package
pause
echo PACKAGING FOR MAC
npm run package -- --mac
pause
echo PACKAGING FOR LINUX
npm run package -- --linux
pause
echo ALL DONE!
pause