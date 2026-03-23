FROM nginx:1.15.2-alpine

COPY nginx.conf /etc/nginx/nginx.conf
COPY web.conf /etc/nginx/conf.d/web.conf
COPY dist /usr/share/nginx/html/ball

CMD ["nginx", "-g", "daemon off;"]
