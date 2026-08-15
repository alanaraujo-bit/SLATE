// Sem console no Windows em build de release: um agente residente que abre uma
// janela preta de terminal ao iniciar parece software mal feito.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    slate_agente_lib::run()
}
