import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import Backend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'pt-BR', 'es', 'fr', 'de', 'ja', 'zh-CN'],
    interpolation: { escapeValue: false },
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json', // Corrija este caminho após mover os arquivos para public/locales
    },
  });

export default i18n;