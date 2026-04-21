# Usa la imagen del SDK oficial de .NET 8 para compilar la aplicación
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copiamos el archivo de configuración y restauramos dependencias
COPY ["ColorGame.csproj", "./"]
RUN dotnet restore "./ColorGame.csproj"

# Copiamos todo el código fuente y compilamos en modo Release
COPY . .
RUN dotnet build "ColorGame.csproj" -c Release -o /app/build

# Se publica (prepara) la app final optimizada
FROM build AS publish
RUN dotnet publish "ColorGame.csproj" -c Release -o /app/publish

# Usamos la imagen ASP.NET (más ligera, solo para ejecución)
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app

# Por defecto en .NET 8 el puerto es 8080.
# Render detectará el EXPOSE automáticamente.
EXPOSE 8080
ENV ASPNETCORE_HTTP_PORTS=8080

# Copiamos el resultado de la publicación anterior
COPY --from=publish /app/publish .

# Comando de inicio
ENTRYPOINT ["dotnet", "ColorGame.dll"]
