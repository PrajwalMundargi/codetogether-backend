export function checkRoomAuth(){
    if(typeof window !== 'undefine'){
        const authData = sessionStorage.getItem('roomAuth');
        if(authData){
            try{
                return JSON.parse(authData);
            }catch(error){
                console.error("Error parsing room auth data:", error);
                return null;
            }
        }
    }
    return null;
}

export function clearRoomAuth(){
    if(typeof window !== 'undefined'){
        sessionStorage.romoveItem('roomAuth');
    }
}