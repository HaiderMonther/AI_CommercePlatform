import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { vuetify } from './plugins/vuetify';
import './assets/styles/main.scss';

const app = createApp(App);

app.use(createPinia());
app.use(vuetify);
app.use(router);

app.mount('#app');
