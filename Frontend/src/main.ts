import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import './styles/theme.css';

import App from './App.vue'
import router from './router'
import { createPinia } from 'pinia'
import { installErrorToastInterceptor } from '@/utils/error-toast'

const app = createApp(App)
installErrorToastInterceptor()
app.use(createPinia())
app.use(ElementPlus, { locale: zhCn })
app.use(router)
app.mount('#app')