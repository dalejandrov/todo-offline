# Todo App - Offline/Online Sync

Una aplicación de tareas TODO construida con React Native (frontend) y Node.js + Express (backend), que funciona tanto en modo offline como online, sincronizando los datos cuando se recupera la conexión.

## 📦 Estructura del Proyecto

todo-sync-demo ├── back/ -> API REST construida con Node.js y Express ├── front/ -> App móvil construida con React Native

## 🚀 Características

- Creación y eliminación de tareas
- Funciona offline y sincroniza con el backend cuando hay conexión
- API REST simple para persistencia de datos

## 🔧 Tecnologías

- **Frontend:** React Native, AsyncStorage
- **Backend:** Node.js, Express, MongoDB
- **Sincronización:** Verificación de conectividad y sincronización de datos local/remoto

## 🛠️ Cómo ejecutar el proyecto

### 1. Clona el repositorio

```bash
git clone https://github.com/dalejandrov/todo-offline.git
cd todo-offline
```

### 2. Backend

```bash
cd back
npm install
npm run dev
```

### 2. Frontend

```bash
cd ../front
npm install
npx expo start
```

Requiere tener Node.js, npm y Expo CLI instalados, Docker.


