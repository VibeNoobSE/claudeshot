registerGame("simon", "🔴 Simon Says", "Click the colored buttons in order", "Repeat the sequence — longest streak wins!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a2e");
    this.colors=[0xe94560,0x4ecca3,0xf7c948,0x5dade2];
    this.btns=[];this.sequence=[];this.playerSeq=[];this.showing=false;this.score=0;
    const positions=[[W/2-60,H/2-60],[W/2+60,H/2-60],[W/2-60,H/2+60],[W/2+60,H/2+60]];
    positions.forEach(([x,y],i)=>{
      const btn=this.add.rectangle(x,y,90,90,this.colors[i]).setInteractive().setAlpha(0.5);
      btn.on("pointerdown",()=>this.pressBtn(i));this.btns.push(btn);
    });
    this.msgTxt=this.add.text(W/2,30,"Watch the sequence...",{fontSize:"20px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.scoreTxt=this.add.text(W/2,H-30,"Score: 0",{fontSize:"18px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);
    this.addToSequence();
  }
  addToSequence(){
    this.sequence.push(Phaser.Math.Between(0,3));this.playerSeq=[];this.showing=true;
    this.msgTxt.setText("Watch...");
    let delay=500;
    this.sequence.forEach((idx,i)=>{
      this.time.delayedCall(delay+i*600,()=>{this.flashBtn(idx);});
    });
    this.time.delayedCall(delay+this.sequence.length*600,()=>{this.showing=false;this.msgTxt.setText("Your turn! ("+this.sequence.length+" buttons)");});
  }
  flashBtn(idx){this.btns[idx].setAlpha(1);this.time.delayedCall(300,()=>this.btns[idx].setAlpha(0.5));}
  pressBtn(idx){
    if(this.showing)return;
    this.flashBtn(idx);
    this.playerSeq.push(idx);
    const i=this.playerSeq.length-1;
    if(this.playerSeq[i]!==this.sequence[i]){
      this.msgTxt.setText("WRONG! Final score: "+this.score).setColor("#e94560");this.showing=true;return;
    }
    if(this.playerSeq.length===this.sequence.length){
      this.score++;this.scoreTxt.setText("Score: "+this.score);
      this.msgTxt.setText("Correct!");
      this.time.delayedCall(1000,()=>this.addToSequence());
    }
  }
  update(){}
});
