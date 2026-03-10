registerGame("typing-race", "⌨️ Typing Race", "Just type the words!", "Type fastest to win the race!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a2e");
    this.words=["code","debug","deploy","sprint","merge","commit","push","pull","branch","review","build","test","ship","hack","stack","queue","array","loop","class","async"];
    this.currentWord=Phaser.Utils.Array.GetRandom(this.words);
    this.typed="";this.score=0;this.wordsComplete=0;this.totalWords=10;
    this.wordTxt=this.add.text(W/2,H/2-20,this.currentWord,{fontSize:"48px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.typedTxt=this.add.text(W/2,H/2+40,"",{fontSize:"48px",color:"#4ecca3",fontFamily:"monospace"}).setOrigin(0.5);
    this.progressTxt=this.add.text(W/2,30,"Words: 0/"+this.totalWords,{fontSize:"18px",color:"#888",fontFamily:"monospace"}).setOrigin(0.5);
    this.add.text(W/2,H-30,"Type the word shown — race against your best time!",{fontSize:"14px",color:"#666",fontFamily:"monospace"}).setOrigin(0.5);
    this.startTime=this.time.now;
    this.input.keyboard.on("keydown",(e)=>{
      if(e.key.length===1&&e.key.match(/[a-z]/i)){
        this.typed+=e.key.toLowerCase();this.typedTxt.setText(this.typed);
        if(this.typed===this.currentWord){
          this.wordsComplete++;this.progressTxt.setText("Words: "+this.wordsComplete+"/"+this.totalWords);
          if(this.wordsComplete>=this.totalWords){
            const elapsed=((this.time.now-this.startTime)/1000).toFixed(1);
            this.add.text(W/2,H/2,"DONE! "+elapsed+"s",{fontSize:"48px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);
            this.wordTxt.setVisible(false);this.typedTxt.setVisible(false);
          }else{this.typed="";this.currentWord=Phaser.Utils.Array.GetRandom(this.words);this.wordTxt.setText(this.currentWord);this.typedTxt.setText("");}
        }else if(!this.currentWord.startsWith(this.typed)){this.typed="";this.typedTxt.setText("").setColor("#e94560");this.time.delayedCall(200,()=>this.typedTxt.setColor("#4ecca3"));}
      }
    });
  }
  update(){}
});
